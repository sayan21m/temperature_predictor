"""FastAPI server that serves predictions from the pickled models in ``models/``.

Run the training script once first:

    python train_model.py

Then start the server:

    uvicorn main:app --reload --port 8000

The static frontend (docs/prediction.html) calls POST /predict.
"""
import json
import os
from contextlib import asynccontextmanager
from datetime import date as date_type
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

MODELS_DIR = Path(__file__).resolve().parent / "models"

# Dec/Jan/Feb/Mar = Winter, Apr/May/Jun = Summer, Jul/Aug/Sep = Monsoon, Oct/Nov = Post-monsoon
# (matches the season column actually assigned in india_weather_rainfall_data.xlsx,
# NOT the standard IMD Mar-May "summer" convention)
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

models = {}
station_lookup = {}
metadata = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    yield
    models.clear()
    station_lookup.clear()
    metadata.clear()


app = FastAPI(title="Temperature Predictor API", version="1.0.0", lifespan=lifespan)

# defaults to permissive CORS so the demo works immediately; set the
# ALLOWED_ORIGINS env var (comma-separated) on Render once you know your
# GitHub Pages URL, e.g. https://<user>.github.io, to lock this down
_origins_env = os.environ.get("ALLOWED_ORIGINS", "*").strip()
_allow_origins = ["*"] if _origins_env == "*" else [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    state: str = Field(..., description="Full state name, e.g. 'West Bengal'")
    district: str
    station_name: str
    date: date_type = Field(..., description="YYYY-MM-DD")
    rainfall: float = Field(..., ge=0, description="mm")
    wind_speed: float = Field(..., ge=0, description="m/s")
    air_pressure: float = Field(..., ge=800, description="hPa")


class PredictResponse(BaseModel):
    avg_temp: float
    min_temp: float
    max_temp: float
    resolved: dict


@app.get("/health")
def health():
    return {"status": "ok", "targets": list(models.keys()), "trained_at": metadata.get("trained_at")}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    key = f"{req.state}|{req.district}|{req.station_name}"
    station = station_lookup.get(key)
    if station is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Unknown station '{req.station_name}' in {req.district}, {req.state}. "
                "State/district/station must match the training dataset exactly."
            ),
        )

    day_of_year = req.date.timetuple().tm_yday
    month = MONTH_NAMES[req.date.month - 1]
    season = MONTH_TO_SEASON[req.date.month]

    row = pd.DataFrame([{
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
        "state": req.state,
        "district": req.district,
        "station_name": req.station_name,
    }])[metadata["feature_cols"]]

    predictions = {target: float(models[target].predict(row)[0]) for target in metadata["target_cols"]}

    # keep the three values in a sensible order for display
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
