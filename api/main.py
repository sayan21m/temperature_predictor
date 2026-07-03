"""FastAPI server that serves predictions from the pickled models in ``models/``.

Run the training scripts once first:

    python train_model.py
    python train_forecaster.py

Then start the server:

    uvicorn main:app --reload --port 8000

The static frontend (docs/prediction.html) calls:
  - POST /predict  — same-day avg / min / max (HistGradientBoosting)
  - POST /forecast — 7-day average-temperature outlook (chained LightGBM)
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import date as date_type, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from train_forecaster import LEAD_TARGET_COLS, prepare_features

MODELS_DIR = Path(__file__).resolve().parent / "models"
FORECASTER_DIR = MODELS_DIR / "forecaster"

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
MONTH_TO_SEASON = {
    12: "Winter", 1: "Winter", 2: "Winter", 3: "Winter",
    4: "Summer", 5: "Summer", 6: "Summer",
    7: "Monsoon", 8: "Monsoon", 9: "Monsoon",
    10: "Post-monsoon", 11: "Post-monsoon",
}

# analysis.ipynb trains on spreadsheet state codes (e.g. "WB"); docs/data.json uses full names.
STATE_FULL_TO_CODE = {
    "Jammu and Kashmir": "JK", "Punjab": "PB", "Himachal Pradesh": "HP", "Haryana": "HR",
    "Chandigarh": "CH", "Uttar Pradesh": "UP", "Rajasthan": "RJ", "Delhi": "DL",
    "Arunachal Pradesh": "AR", "West Bengal": "WB", "Sikkim": "SK", "Assam": "AS",
    "Madhya Pradesh": "MP", "Bihar": "BR", "Meghalaya": "ML", "Nagaland": "NL",
    "Gujarat": "GJ", "Tripura": "TR", "Manipur": "MN", "Mizoram": "MZ", "Odisha": "OR",
    "Maharashtra": "MH", "Chhattisgarh": "CT", "Daman and Diu": "DD", "Karnataka": "KA",
    "Andhra Pradesh": "AP", "Goa": "GA", "Tamil Nadu": "TN", "Lakshadweep": "LD",
    "Andaman and Nicobar Islands": "AN", "Kerala": "KL", "Puducherry": "PY",
}
STATE_CODES = set(STATE_FULL_TO_CODE.values())


def resolve_state_code(state: str) -> str:
    if state in STATE_CODES:
        return state
    code = STATE_FULL_TO_CODE.get(state)
    if code is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown state '{state}'. Use a full state name or two-letter code from the dataset.",
        )
    return code

models = {}
forecaster_models: dict[str, object] = {}
station_lookup = {}
metadata = {}
forecaster_metadata: dict = {}
station_month_climo = pd.DataFrame()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global station_month_climo
    try:
        metadata.update(json.loads((MODELS_DIR / "metadata.json").read_text()))
        station_lookup.update(json.loads((MODELS_DIR / "station_lookup.json").read_text()))
        for target in metadata["target_cols"]:
            models[target] = joblib.load(MODELS_DIR / f"{target}_model.joblib")
    except FileNotFoundError as exc:
        raise RuntimeError(
            "Model files not found. Run `python train_model.py` inside the api/ "
            "folder first."
        ) from exc

    # Multi-day forecaster models are optional at startup; /forecast returns 503 if missing.
    try:
        forecaster_metadata.update(json.loads((FORECASTER_DIR / "metadata.json").read_text()))
        climo_records = json.loads((FORECASTER_DIR / "station_month_climo.json").read_text())
        station_month_climo = pd.DataFrame(climo_records)
        for target in forecaster_metadata["target_cols"]:
            forecaster_models[target] = joblib.load(FORECASTER_DIR / f"{target}_model.joblib")
    except FileNotFoundError:
        pass

    yield
    models.clear()
    forecaster_models.clear()
    station_lookup.clear()
    metadata.clear()
    forecaster_metadata.clear()
    station_month_climo = pd.DataFrame()


app = FastAPI(title="Temperature Predictor API", version="1.0.0", lifespan=lifespan)

_origins_env = os.environ.get("ALLOWED_ORIGINS", "*").strip()
_allow_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    state: str = Field(..., description="Full state name or code, e.g. 'West Bengal' or 'WB'")
    district: str
    station_name: str
    date: date_type = Field(..., description="YYYY-MM-DD")

    rainfall: float = Field(..., ge=0, description="mm")
    wind_speed: float = Field(..., ge=0, description="m/s")
    air_pressure: float = Field(..., ge=800, description="hPa")

    temp_lag_1: float | None = Field(None, description="Previous 1-day average temperature")
    temp_lag_3: float | None = Field(None, description="Previous 3-day average temperature")
    temp_lag_7: float | None = Field(None, description="Previous 7-day average temperature")

    temp_max_lag_1: float | None = Field(None, description="Previous 1-day maximum temperature")
    temp_max_lag_3: float | None = Field(None, description="Previous 3-day maximum temperature")
    temp_max_lag_7: float | None = Field(None, description="Previous 7-day maximum temperature")

    rain_lag_1: float | None = Field(None, ge=0, description="Previous 1-day rainfall")
    rain_lag_3: float | None = Field(None, ge=0, description="Previous 3-day rainfall")
    rain_lag_7: float | None = Field(None, ge=0, description="Previous 7-day rainfall")


class PredictResponse(BaseModel):
    avg_temp: float
    min_temp: float
    max_temp: float
    resolved: dict


class ForecastRequest(PredictRequest):
    """Extended lag / rolling features used by the chained LightGBM forecaster."""

    temp_lag_2: float | None = Field(None, description="Previous 2-day average temperature")
    temp_lag_14: float | None = Field(None, description="Previous 14-day average temperature")

    temp_max_lag_2: float | None = Field(None, description="Previous 2-day maximum temperature")
    temp_max_lag_14: float | None = Field(None, description="Previous 14-day maximum temperature")

    rain_lag_2: float | None = Field(None, ge=0, description="Previous 2-day rainfall")
    rain_lag_14: float | None = Field(None, ge=0, description="Previous 14-day rainfall")

    temp_ma_3: float | None = Field(None, description="3-day rolling mean of avg temp (lags 1–3)")
    temp_ma_7: float | None = Field(None, description="7-day rolling mean of avg temp (lags 1–7)")
    temp_trend_7: float | None = Field(None, description="temp_lag_1 minus temp_lag_7")


class ForecastDay(BaseModel):
    day_offset: int = Field(..., description="0 = selected date, 6 = six days ahead")
    date: date_type
    avg_temp: float


class ForecastResponse(BaseModel):
    base_date: date_type
    forecasts: list[ForecastDay]
    resolved: dict


def _station_row(req: PredictRequest, state_code: str, station: dict) -> dict:
    """Build the static station / calendar fields shared by predict and forecast."""
    day_of_year = req.date.timetuple().tm_yday
    month = MONTH_NAMES[req.date.month - 1]
    season = MONTH_TO_SEASON[req.date.month]
    return {
        "date_of_record": pd.Timestamp(req.date),
        "year": req.date.year,
        "sin_day": np.sin(2 * np.pi * day_of_year / 365.25),
        "cos_day": np.cos(2 * np.pi * day_of_year / 365.25),
        "rainfall": req.rainfall,
        "wind_speed": req.wind_speed,
        "air_pressure": req.air_pressure,
        "elevation": station["elevation"],
        "latitude": station["latitude"],
        "longitude": station["longitude"],
        "month": month,
        "season": season,
        "state": state_code,
        "district": req.district,
        "station_name": req.station_name,
    }


def _derive_forecaster_rolling(req: ForecastRequest) -> tuple[float | None, float | None, float | None]:
    """Fill temp_ma_3 / temp_ma_7 / temp_trend_7 from lags when the client omitted them."""
    ma3 = req.temp_ma_3
    if ma3 is None:
        short = [v for v in (req.temp_lag_1, req.temp_lag_2, req.temp_lag_3) if v is not None]
        if len(short) >= 2:
            ma3 = sum(short) / len(short)

    ma7 = req.temp_ma_7
    if ma7 is None:
        week = [
            v for v in (
                req.temp_lag_1, req.temp_lag_2, req.temp_lag_3, None, None, None, req.temp_lag_7,
            ) if v is not None
        ]
        if len(week) >= 3:
            ma7 = sum(week) / len(week)

    trend = req.temp_trend_7
    if trend is None and req.temp_lag_1 is not None and req.temp_lag_7 is not None:
        trend = req.temp_lag_1 - req.temp_lag_7

    return ma3, ma7, trend


def _lookup_station(req: PredictRequest, state_code: str) -> dict:
    key = f"{state_code}|{req.district}|{req.station_name}"
    station = station_lookup.get(key)
    if station is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Unknown station '{req.station_name}' in {req.district}, {req.state}. "
                "State/district/station must match the training dataset exactly."
            ),
        )
    return station


@app.get("/health")
def health():
    return {
        "status": "ok",
        "targets": list(models.keys()),
        "forecast_targets": list(forecaster_models.keys()),
        "trained_at": metadata.get("trained_at"),
        "forecaster_trained_at": forecaster_metadata.get("trained_at"),
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    state_code = resolve_state_code(req.state)
    station = _lookup_station(req, state_code)

    month = MONTH_NAMES[req.date.month - 1]
    season = MONTH_TO_SEASON[req.date.month]

    row_data = {
        **_station_row(req, state_code, station),
        "temp_lag_1": req.temp_lag_1,
        "temp_lag_3": req.temp_lag_3,
        "temp_lag_7": req.temp_lag_7,
        "temp_max_lag_1": req.temp_max_lag_1,
        "temp_max_lag_3": req.temp_max_lag_3,
        "temp_max_lag_7": req.temp_max_lag_7,
        "rain_lag_1": req.rain_lag_1,
        "rain_lag_3": req.rain_lag_3,
        "rain_lag_7": req.rain_lag_7,
    }

    row = pd.DataFrame([row_data]).reindex(columns=metadata["feature_cols"])

    predictions = {target: float(models[target].predict(row)[0]) for target in metadata["target_cols"]}

    if predictions["min_temp"] > predictions["avg_temp"]:
        predictions["min_temp"] = predictions["avg_temp"]
    if predictions["max_temp"] < predictions["avg_temp"]:
        predictions["max_temp"] = predictions["avg_temp"]

    return PredictResponse(
        **predictions,
        resolved={
            "month": month,
            "season": season,
            "elevation": station["elevation"],
            "latitude": station["latitude"],
            "longitude": station["longitude"],
        },
    )


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    """Return a 7-day average-temperature outlook (day 0 … day 6) via chained LightGBM models."""
    if not forecaster_models:
        raise HTTPException(
            status_code=503,
            detail="Forecaster models not loaded. Run `python train_forecaster.py` inside api/ first.",
        )

    state_code = resolve_state_code(req.state)
    station = _lookup_station(req, state_code)
    month = MONTH_NAMES[req.date.month - 1]
    season = MONTH_TO_SEASON[req.date.month]
    temp_ma_3, temp_ma_7, temp_trend_7 = _derive_forecaster_rolling(req)

    # Single observation row; horizon-specific calendar features are applied in prepare_features.
    base_row = pd.DataFrame([{
        **_station_row(req, state_code, station),
        "temp_lag_1": req.temp_lag_1,
        "temp_lag_2": req.temp_lag_2,
        "temp_lag_3": req.temp_lag_3,
        "temp_lag_7": req.temp_lag_7,
        "temp_lag_14": req.temp_lag_14,
        "temp_max_lag_1": req.temp_max_lag_1,
        "temp_max_lag_2": req.temp_max_lag_2,
        "temp_max_lag_3": req.temp_max_lag_3,
        "temp_max_lag_7": req.temp_max_lag_7,
        "temp_max_lag_14": req.temp_max_lag_14,
        "rain_lag_1": req.rain_lag_1,
        "rain_lag_2": req.rain_lag_2,
        "rain_lag_3": req.rain_lag_3,
        "rain_lag_7": req.rain_lag_7,
        "rain_lag_14": req.rain_lag_14,
        "temp_ma_3": temp_ma_3,
        "temp_ma_7": temp_ma_7,
        "temp_trend_7": temp_trend_7,
    }])

    # Recursive chain: lead_k (k >= 2) feeds the previous horizon's predicted average temp.
    chain_pred: float | None = None
    forecasts: list[ForecastDay] = []

    for target_col in forecaster_metadata["target_cols"]:
        horizon = 0 if target_col == "avg_temp" else int(target_col.rsplit("_", 1)[-1])
        use_chain = horizon > 1
        features = prepare_features(
            base_row,
            horizon,
            station_month_climo,
            chain_temp=np.array([chain_pred]) if use_chain and chain_pred is not None else None,
            use_chain=use_chain,
        )
        pred = float(forecaster_models[target_col].predict(features)[0])
        forecast_date = req.date + timedelta(days=horizon)
        forecasts.append(ForecastDay(day_offset=horizon, date=forecast_date, avg_temp=pred))

        if target_col in LEAD_TARGET_COLS:
            chain_pred = pred

    return ForecastResponse(
        base_date=req.date,
        forecasts=forecasts,
        resolved={
            "month": month,
            "season": season,
            "elevation": station["elevation"],
            "latitude": station["latitude"],
            "longitude": station["longitude"],
        },
    )