"""Train multi-day temperature forecast models from ``forcaster_model.ipynb``.

Reproduces the notebook pipeline: per-station lags/MAs, horizon-aligned calendar
features, station-month climatology, and recursive chaining (lead_k uses the
predicted lead_{k-1} for k >= 2).

Run once (and again whenever the source spreadsheet changes):

    python train_forecaster.py

Artifacts are written to ``api/models/forecaster/``.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = REPO_ROOT / "india_weather_rainfall_data.xlsx"
MODELS_DIR = Path(__file__).resolve().parent / "models" / "forecaster"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

STATION_GROUP = ["state", "district", "station_name"]
CUTOFF_DATE = "2024-01-01"

FEATURE_COLS = [
    "year", "sin_day", "cos_day", "rainfall", "wind_speed", "air_pressure",
    "elevation", "latitude", "longitude", "month", "season", "state",
    "district", "station_name",
    "temp_lag_1", "temp_lag_2", "temp_lag_3", "temp_lag_7", "temp_lag_14",
    "temp_max_lag_1", "temp_max_lag_2", "temp_max_lag_3", "temp_max_lag_7", "temp_max_lag_14",
    "rain_lag_1", "rain_lag_2", "rain_lag_3", "rain_lag_7", "rain_lag_14",
    "temp_ma_3", "temp_ma_7", "temp_trend_7", "station_month_climo", "chain_temp",
]
TARGET_COLS = [
    "avg_temp", "temp_lead_1", "temp_lead_2", "temp_lead_3",
    "temp_lead_4", "temp_lead_5", "temp_lead_6",
]
LEAD_TARGET_COLS = [c for c in TARGET_COLS if c.startswith("temp_lead_")]

NUMERIC_FEATURES = [
    "year", "sin_day", "cos_day", "rainfall", "wind_speed", "air_pressure",
    "elevation", "latitude", "longitude",
    "temp_lag_1", "temp_lag_2", "temp_lag_3", "temp_lag_7", "temp_lag_14",
    "temp_max_lag_1", "temp_max_lag_2", "temp_max_lag_3", "temp_max_lag_7", "temp_max_lag_14",
    "rain_lag_1", "rain_lag_2", "rain_lag_3", "rain_lag_7", "rain_lag_14",
    "temp_ma_3", "temp_ma_7", "temp_trend_7", "station_month_climo", "chain_temp",
]
CATEGORICAL_FEATURES = ["month", "season", "state", "district", "station_name"]

MONTH_TO_SEASON = {
    "January": "Winter", "February": "Winter", "March": "Winter", "December": "Winter",
    "April": "Summer", "May": "Summer", "June": "Summer",
    "July": "Monsoon", "August": "Monsoon", "September": "Monsoon",
    "October": "Post-monsoon", "November": "Post-monsoon",
}


def load_and_engineer_features(data_path: Path = DATA_PATH) -> pd.DataFrame:
    print(f"Loading {data_path} ...")
    df = pd.read_excel(data_path)
    df["date_of_record"] = pd.to_datetime(df["date_of_record"])
    df["day_of_year"] = df["date_of_record"].dt.dayofyear
    df["year"] = df["date_of_record"].dt.year
    df = df.sort_values([*STATION_GROUP, "date_of_record"])

    df["sin_day"] = np.sin(2 * np.pi * df["day_of_year"] / 365.25)
    df["cos_day"] = np.cos(2 * np.pi * df["day_of_year"] / 365.25)

    for lag in [1, 2, 3, 7, 14]:
        df[f"temp_lag_{lag}"] = df.groupby(STATION_GROUP)["avg_temp"].shift(lag)
        df[f"temp_max_lag_{lag}"] = df.groupby(STATION_GROUP)["max_temp"].shift(lag)
        df[f"rain_lag_{lag}"] = df.groupby(STATION_GROUP)["rainfall"].shift(lag)

    df["temp_ma_3"] = (
        df.groupby(STATION_GROUP)["avg_temp"]
        .transform(lambda s: s.shift(1).rolling(3, min_periods=2).mean())
    )
    df["temp_ma_7"] = (
        df.groupby(STATION_GROUP)["avg_temp"]
        .transform(lambda s: s.shift(1).rolling(7, min_periods=3).mean())
    )
    df["temp_trend_7"] = df["temp_lag_1"] - df["temp_lag_7"]

    for lead in range(1, 7):
        df[f"temp_lead_{lead}"] = df.groupby(STATION_GROUP)["avg_temp"].shift(-lead)

    return df


def build_station_month_climo(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.groupby([*STATION_GROUP, "month"], observed=True)["avg_temp"]
        .mean()
        .reset_index(name="station_month_climo")
    )


def horizon_from_target(target_col: str) -> int:
    return 0 if target_col == "avg_temp" else int(target_col.rsplit("_", 1)[-1])


def model_feature_cols(use_chain: bool) -> list[str]:
    if use_chain:
        return FEATURE_COLS
    return [c for c in FEATURE_COLS if c != "chain_temp"]


def model_numeric_features(use_chain: bool) -> list[str]:
    if use_chain:
        return NUMERIC_FEATURES
    return [c for c in NUMERIC_FEATURES if c != "chain_temp"]


def prepare_features(
    df: pd.DataFrame,
    horizon: int,
    station_month_climo: pd.DataFrame,
    chain_temp: np.ndarray | None = None,
    *,
    use_chain: bool = False,
) -> pd.DataFrame:
    """Align calendar/climatology with the forecast date; optionally chain prior-step predictions."""
    base_cols = [c for c in FEATURE_COLS if c not in {"station_month_climo", "chain_temp"}]
    x = df[base_cols].copy()

    if horizon > 0:
        forecast_dates = df["date_of_record"] + pd.to_timedelta(horizon, unit="D")
        doy = forecast_dates.dt.dayofyear
        x["sin_day"] = np.sin(2 * np.pi * doy / 365.25)
        x["cos_day"] = np.cos(2 * np.pi * doy / 365.25)
        merge_month = forecast_dates.dt.month_name()
        x["month"] = merge_month
        x["season"] = merge_month.map(MONTH_TO_SEASON)
    else:
        merge_month = df["month"]

    climo_keys = df[[*STATION_GROUP]].copy()
    climo_keys["month"] = merge_month.values
    climo_keys = climo_keys.merge(
        station_month_climo,
        on=[*STATION_GROUP, "month"],
        how="left",
    )
    x["station_month_climo"] = climo_keys["station_month_climo"].values
    if use_chain:
        x["chain_temp"] = chain_temp if chain_temp is not None else np.nan
    return x[model_feature_cols(use_chain)]


def build_model(*, use_chain: bool = False) -> Pipeline:
    numeric_features = model_numeric_features(use_chain)
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", SimpleImputer(strategy="median"), numeric_features),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "encoder",
                            OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1),
                        ),
                    ]
                ),
                CATEGORICAL_FEATURES,
            ),
        ]
    )
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "lgbm",
                lgb.LGBMRegressor(
                    boosting_type="gbdt",
                    objective="regression",
                    metric="rmse",
                    num_leaves=63,
                    learning_rate=0.05,
                    feature_fraction=0.9,
                    bagging_fraction=0.8,
                    bagging_freq=5,
                    min_child_samples=40,
                    n_estimators=800,
                    random_state=42,
                    verbose=-1,
                ),
            ),
        ]
    )


def fit_and_evaluate(
    train: pd.DataFrame,
    test: pd.DataFrame,
    target_col: str,
    horizon: int,
    station_month_climo: pd.DataFrame,
    *,
    use_chain: bool = False,
    chain_train: pd.Series | None = None,
    chain_test: pd.Series | None = None,
) -> tuple[Pipeline, np.ndarray, pd.Series, pd.Index, pd.Index]:
    train_mask = train[target_col].notna()
    test_mask = test[target_col].notna()
    train_idx = train.index[train_mask]
    test_idx = test.index[test_mask]

    x_train = prepare_features(
        train.loc[train_mask],
        horizon,
        station_month_climo,
        chain_temp=None if chain_train is None else chain_train.loc[train_idx].values,
        use_chain=use_chain,
    )
    x_test = prepare_features(
        test.loc[test_mask],
        horizon,
        station_month_climo,
        chain_temp=None if chain_test is None else chain_test.loc[test_idx].values,
        use_chain=use_chain,
    )
    y_train = train.loc[train_mask, target_col]
    y_test = test.loc[test_mask, target_col]

    model = build_model(use_chain=use_chain)
    model.fit(x_train, y_train)
    predictions = model.predict(x_test)
    return model, predictions, y_test, train_idx, test_idx


def _fit_on_data(
    data: pd.DataFrame,
    target_col: str,
    horizon: int,
    station_month_climo: pd.DataFrame,
    *,
    use_chain: bool = False,
    chain: pd.Series | None = None,
) -> tuple[Pipeline, pd.Index]:
    mask = data[target_col].notna()
    idx = data.index[mask]
    x = prepare_features(
        data.loc[mask],
        horizon,
        station_month_climo,
        chain_temp=None if chain is None else chain.loc[idx].values,
        use_chain=use_chain,
    )
    y = data.loc[mask, target_col]
    model = build_model(use_chain=use_chain)
    model.fit(x, y)
    return model, idx


def train_chained(
    train: pd.DataFrame,
    test: pd.DataFrame | None,
    station_month_climo: pd.DataFrame,
) -> tuple[dict[str, Pipeline], list[dict]]:
    """Train recursive forecast models; evaluate on *test* when provided."""
    models: dict[str, Pipeline] = {}
    metrics: list[dict] = []
    evaluate = test is not None

    chain_train: pd.Series | None = None
    chain_test: pd.Series | None = None

    for target_col in TARGET_COLS:
        horizon = horizon_from_target(target_col)
        use_chain_feature = horizon > 1

        if evaluate:
            model, predictions, y_test, train_idx, test_idx = fit_and_evaluate(
                train,
                test,
                target_col,
                horizon,
                station_month_climo,
                use_chain=use_chain_feature,
                chain_train=chain_train if use_chain_feature else None,
                chain_test=chain_test if use_chain_feature else None,
            )
            metrics.append(
                _metric_row(target_col, horizon, use_chain_feature, train, test, y_test, predictions)
            )
            print(_format_metric(metrics[-1]))
        else:
            model, train_idx = _fit_on_data(
                train,
                target_col,
                horizon,
                station_month_climo,
                use_chain=use_chain_feature,
                chain=chain_train if use_chain_feature else None,
            )

        models[target_col] = model

        if target_col in LEAD_TARGET_COLS:
            train_preds = pd.Series(index=train.index, dtype=float)
            train_preds.loc[train_idx] = model.predict(
                prepare_features(
                    train.loc[train_idx],
                    horizon,
                    station_month_climo,
                    chain_temp=None if not use_chain_feature else chain_train.loc[train_idx].values,
                    use_chain=use_chain_feature,
                )
            )
            chain_train = train_preds

            if evaluate:
                test_preds = pd.Series(index=test.index, dtype=float)
                test_preds.loc[test_idx] = predictions
                chain_test = test_preds

    return models, metrics


def _metric_row(
    target_col: str,
    horizon: int,
    chained: bool,
    train: pd.DataFrame,
    test: pd.DataFrame,
    y_test: pd.Series,
    predictions: np.ndarray,
) -> dict:
    return {
        "target": target_col,
        "horizon_days": horizon,
        "chained": chained,
        "train_rows": int(train[target_col].notna().sum()),
        "test_rows": int(test[target_col].notna().sum()),
        "mae": float(mean_absolute_error(y_test, predictions)),
        "rmse": float(mean_squared_error(y_test, predictions) ** 0.5),
        "r2": float(r2_score(y_test, predictions)),
    }


def _format_metric(row: dict) -> str:
    return (
        f"{row['target']}: MAE={row['mae']:.3f}  "
        f"RMSE={row['rmse']:.3f}  R2={row['r2']:.4f}"
    )


def save_artifacts(
    models: dict[str, Pipeline],
    station_month_climo: pd.DataFrame,
    holdout_metrics: list[dict],
) -> None:
    for target, model in models.items():
        path = MODELS_DIR / f"{target}_model.joblib"
        joblib.dump(model, path)
        print(f"Saved {path}")

    climo_path = MODELS_DIR / "station_month_climo.json"
    with open(climo_path, "w") as f:
        json.dump(station_month_climo.to_dict(orient="records"), f, indent=2)
    print(f"Saved {climo_path}")

    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "source_notebook": "data_analysis/forcaster_model.ipynb",
        "model": "LGBMRegressor",
        "feature_cols": FEATURE_COLS,
        "target_cols": TARGET_COLS,
        "lead_target_cols": LEAD_TARGET_COLS,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "chained_from_horizon": 2,
        "holdout_cutoff_date": CUTOFF_DATE,
        "holdout_metrics": holdout_metrics,
    }
    meta_path = MODELS_DIR / "metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved {meta_path}")


def main() -> None:
    df = load_and_engineer_features()

    train = df[df["date_of_record"] < CUTOFF_DATE].copy()
    test = df[df["date_of_record"] >= CUTOFF_DATE].copy()
    print(f"Train rows: {len(train):,}  Test rows: {len(test):,}")

    holdout_climo = build_station_month_climo(train)
    print("\n=== Holdout evaluation (2024+) ===")
    _, holdout_metrics = train_chained(train, test, holdout_climo)

    print("\n=== Refit on all data ===")
    full_climo = build_station_month_climo(df)
    final_models, _ = train_chained(df, None, full_climo)

    save_artifacts(final_models, full_climo, holdout_metrics)


if __name__ == "__main__":
    main()
