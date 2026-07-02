"""Trains and pickles the temperature prediction models used by ``main.py``.

Reproduces the feature engineering from ``data_analysis/analysis.ipynb``
(date -> year/sin_day/cos_day, no min_temp/max_temp leakage into inputs) and
saves one HistGradientBoostingRegressor pipeline per target as a joblib file,
plus a station lookup table so the API can resolve elevation/latitude/
longitude for a station without the frontend having to send them.

Run once (and again whenever the source spreadsheet changes):

    python train_model.py
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = REPO_ROOT / "india_weather_rainfall_data.xlsx"
MODELS_DIR = Path(__file__).resolve().parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# same abbreviation -> full name mapping used by data_analysis/json_dumper_pipeline.py,
# kept in sync so the state/district values from the website's dropdowns are
# exactly the categories this model was trained on
STATE_MAPPING = {
    "JK": "Jammu and Kashmir", "PB": "Punjab", "HP": "Himachal Pradesh", "HR": "Haryana",
    "CH": "Chandigarh", "UP": "Uttar Pradesh", "RJ": "Rajasthan", "DL": "Delhi",
    "AR": "Arunachal Pradesh", "WB": "West Bengal", "SK": "Sikkim", "AS": "Assam",
    "MP": "Madhya Pradesh", "BR": "Bihar", "ML": "Meghalaya", "NL": "Nagaland",
    "GJ": "Gujarat", "TR": "Tripura", "MN": "Manipur", "MZ": "Mizoram", "OR": "Odisha",
    "MH": "Maharashtra", "CT": "Chhattisgarh", "DD": "Daman and Diu", "KA": "Karnataka",
    "AP": "Andhra Pradesh", "GA": "Goa", "TN": "Tamil Nadu", "LD": "Lakshadweep",
    "AN": "Andaman and Nicobar Islands", "KL": "Kerala", "PY": "Puducherry",
}

FEATURE_COLS = [
    "year", "sin_day", "cos_day", "rainfall", "wind_speed", "air_pressure",
    "elevation", "latitude", "longitude", "month", "season", "state",
    "district", "station_name", "temp_lag_1", "temp_lag_3", "temp_lag_7",
    "temp_max_lag_1", "temp_max_lag_3", "temp_max_lag_7",
    "rain_lag_1", "rain_lag_3", "rain_lag_7"
]
TARGET_COLS = ["avg_temp", "min_temp", "max_temp"]
NUMERIC_FEATURES = [
    "year", "sin_day", "cos_day", "rainfall", "wind_speed", "air_pressure",
    "elevation", "latitude", "longitude", "temp_lag_1", "temp_lag_3", "temp_lag_7",
    "temp_max_lag_1", "temp_max_lag_3", "temp_max_lag_7",
    "rain_lag_1", "rain_lag_3", "rain_lag_7"
]
CATEGORICAL_FEATURES = ["month", "season", "state", "district", "station_name"]

CUTOFF_DATE = "2024-01-01"


def build_pipeline():
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
            (
                "cat",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)),
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
                "regressor",
                HistGradientBoostingRegressor(
                    max_iter=220,
                    learning_rate=0.08,
                    l2_regularization=0.01,
                    random_state=42,
                ),
            ),
        ]
    )


def main():
    print(f"Loading {DATA_PATH} ...")
    df = pd.read_excel(DATA_PATH)
    df["state"] = df["state"].map(STATE_MAPPING)

    df = df.dropna(subset=["date_of_record"])
    df["date_of_record"] = pd.to_datetime(df["date_of_record"])
    df["day_of_year"] = df["date_of_record"].dt.dayofyear
    df["year"] = df["date_of_record"].dt.year
    df["sin_day"] = np.sin(2 * np.pi * df["day_of_year"] / 365.25)
    df["cos_day"] = np.cos(2 * np.pi * df["day_of_year"] / 365.25)

    df["temp_lag_1"] = df['avg_temp'].shift(1)
    df["temp_lag_3"] = df['avg_temp'].shift(3)
    df["temp_lag_7"] = df['avg_temp'].shift(7)

    df["temp_max_lag_1"] = df['max_temp'].shift(1)
    df["temp_max_lag_3"] = df['max_temp'].shift(3)
    df["temp_max_lag_7"] = df['max_temp'].shift(7)

    df["rain_lag_1"] = df['rainfall'].shift(1)
    df["rain_lag_3"] = df['rainfall'].shift(3)
    df["rain_lag_7"] = df['rainfall'].shift(7)

    df = df.sort_values("date_of_record")
    train = df[df["date_of_record"] < CUTOFF_DATE]
    test = df[df["date_of_record"] >= CUTOFF_DATE]

    metrics = {}
    final_pipelines = {}

    for target in TARGET_COLS:
        print(f"\n=== {target} ===")

        # holdout metrics (2024+ as test) so we know how the model actually performs
        train_mask = train[target].notna()
        test_mask = test[target].notna()
        holdout_pipeline = build_pipeline()
        holdout_pipeline.fit(train.loc[train_mask, FEATURE_COLS], train.loc[train_mask, target])
        predictions = holdout_pipeline.predict(test.loc[test_mask, FEATURE_COLS])
        y_test = test.loc[test_mask, target]

        metrics[target] = {
            "train_rows": int(train_mask.sum()),
            "test_rows": int(test_mask.sum()),
            "mae": float(mean_absolute_error(y_test, predictions)),
            "rmse": float(mean_squared_error(y_test, predictions) ** 0.5),
            "r2": float(r2_score(y_test, predictions)),
        }
        print(f"MAE={metrics[target]['mae']:.3f}  RMSE={metrics[target]['rmse']:.3f}  R2={metrics[target]['r2']:.4f}")

        # refit on every available row (train + test) for the model we actually ship
        full_mask = df[target].notna()
        final_pipeline = build_pipeline()
        final_pipeline.fit(df.loc[full_mask, FEATURE_COLS], df.loc[full_mask, target])
        final_pipelines[target] = final_pipeline

        joblib.dump(final_pipeline, MODELS_DIR / f"{target}_model.joblib")
        print(f"Saved {MODELS_DIR / f'{target}_model.joblib'}")

    # station lookup so the API can fill elevation/latitude/longitude by itself
    station_lookup = (
        df.groupby(["state", "district", "station_name"])
        .agg(elevation=("elevation", "mean"), latitude=("latitude", "mean"), longitude=("longitude", "mean"))
        .reset_index()
    )
    lookup = {}
    for row in station_lookup.itertuples(index=False):
        key = f"{row.state}|{row.district}|{row.station_name}"
        lookup[key] = {
            "elevation": round(float(row.elevation), 2),
            "latitude": round(float(row.latitude), 4),
            "longitude": round(float(row.longitude), 4),
        }
    with open(MODELS_DIR / "station_lookup.json", "w") as f:
        json.dump(lookup, f)
    print(f"\nSaved {MODELS_DIR / 'station_lookup.json'} ({len(lookup)} stations)")

    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_cols": FEATURE_COLS,
        "target_cols": TARGET_COLS,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "model": "HistGradientBoostingRegressor",
        "holdout_cutoff_date": CUTOFF_DATE,
        "holdout_metrics": metrics,
    }
    with open(MODELS_DIR / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved {MODELS_DIR / 'metadata.json'}")


if __name__ == "__main__":
    main()
