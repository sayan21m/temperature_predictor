# Temperature Predictor API

FastAPI server that loads pickled scikit-learn / LightGBM pipelines and serves
predictions to `docs/prediction.html`. The static GitHub Pages frontend cannot
run Python models locally, so it calls this API on Render.

## Setup

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 1. Train and pickle the models

### Same-day temperature (`train_model.py`)

Run once (and again when `india_weather_rainfall_data.xlsx` changes). Reproduces
`data_analysis/analysis.ipynb` — calendar features, lag features, state codes as
in the spreadsheet, no `min_temp` / `max_temp` leakage into inputs.

```bash
python train_model.py
```

Writes to `api/models/`:

| File | Purpose |
| --- | --- |
| `avg_temp_model.joblib`, `min_temp_model.joblib`, `max_temp_model.joblib` | One `HistGradientBoostingRegressor` pipeline per target |
| `station_lookup.json` | Elevation / lat / lon per station (filled in server-side) |
| `metadata.json` | Feature column order and holdout metrics |

### 7-day outlook (`train_forecaster.py`)

Reproduces `data_analysis/forcaster_model.ipynb` — per-station lags and rolling
means, horizon-aligned calendar features, station-month climatology, and
recursive chaining (day +2 onward uses the previous horizon’s predicted average).

```bash
python train_forecaster.py
```

Writes to `api/models/forecaster/`:

| File | Purpose |
| --- | --- |
| `avg_temp_model.joblib`, `temp_lead_1_model.joblib` … `temp_lead_6_model.joblib` | Chained `LGBMRegressor` pipelines |
| `station_month_climo.json` | Per-station monthly average temperature |
| `metadata.json` | Feature list, holdout metrics, training timestamp |

`api/models/` is committed (~35 MB including forecaster artifacts) so Render can
serve predictions without the 60+ MB Excel file or a training step at deploy time.
Re-run the training scripts and commit updated `.joblib` files when you retrain.

> **Deploy note:** `/forecast` returns HTTP 503 until `api/models/forecaster/` is
> present on the server. `/predict` works with only the same-day models.

## 2. Run the server locally

```bash
uvicorn main:app --reload --port 8000
```

```bash
curl http://localhost:8000/health
# → {"status":"ok","targets":[...],"forecast_targets":[...],...}
```

## 3. Deploy to Render

The API lives in the `api/` subfolder. Render supports monorepos via **Root
Directory** — no subtree pushing required.

### Option A: Blueprint (recommended)

The repo root has `render.yaml` (`rootDir: api`, build/start commands, health
check). In the [Render Dashboard](https://dashboard.render.com): **New +** →
**Blueprint** → connect this repo.

### Option B: Manual web service

| Setting | Value |
| --- | --- |
| Root Directory | `api` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

```bash
curl https://your-service-name.onrender.com/health
```

Every push to the connected branch redeploys automatically.

> **Free plan:** Services spin down after ~15 minutes of inactivity. Cold starts
> can take 30–50 seconds. `docs/prediction.js` uses a 45s timeout, warms the API
> with `GET /health` on page load, and shows “Waking up model…” on the button.

### CORS (optional)

By default `ALLOWED_ORIGINS=*`. Once GitHub Pages is live, restrict in Render
**Environment**:

```
ALLOWED_ORIGINS=https://<your-github-username>.github.io
```

## 4. Point the frontend at your deployed API

In `docs/prediction.js`:

```js
const PREDICTION_API_BASE_URL = 'https://your-service-name.onrender.com';
```

Predictions are served only from this backend. If the API is unreachable, the
page shows an error — no substitute prediction.

---

## API reference

### `GET /health`

Returns loaded model targets and training timestamps.

### `POST /predict`

Same-day average, minimum and maximum temperature.

**Request** (lag fields optional — pipeline imputes missing values):

```json
{
  "state": "West Bengal",
  "district": "Kolkata",
  "station_name": "Calcutta / Alipore",
  "date": "2026-07-02",
  "rainfall": 5.2,
  "wind_speed": 8.0,
  "air_pressure": 999.0,
  "temp_lag_1": 28.5,
  "temp_lag_3": 29.1,
  "temp_lag_7": 30.0
}
```

`state` accepts full names (e.g. `"West Bengal"`) or codes (`"WB"`). District
and station must match the training dataset exactly (same values as the
`docs/prediction.html` dropdowns).

**Response:**

```json
{
  "avg_temp": 29.1,
  "min_temp": 25.8,
  "max_temp": 33.4,
  "resolved": {
    "month": "July",
    "season": "Monsoon",
    "elevation": 5.0,
    "latitude": 22.5333,
    "longitude": 88.3333
  }
}
```

### `POST /forecast`

Seven-day average-temperature outlook: `day_offset` 0 = selected date through
6 = six days ahead. Uses extended lag features (1, 2, 3, 7, 14-day lags,
`temp_ma_3`, `temp_ma_7`, `temp_trend_7`). The frontend sends these after a
single bulk Open-Meteo history fetch.

**Request:** same fields as `/predict`, plus forecaster lags when available:

```json
{
  "state": "WB",
  "district": "Kolkata",
  "station_name": "Calcutta / Alipore",
  "date": "2026-07-02",
  "rainfall": 5.2,
  "wind_speed": 8.0,
  "air_pressure": 999.0,
  "temp_lag_1": 28.5,
  "temp_lag_2": 28.8,
  "temp_lag_3": 29.0,
  "temp_lag_7": 30.0,
  "temp_lag_14": 31.2,
  "temp_ma_3": 28.8,
  "temp_ma_7": 29.5,
  "temp_trend_7": -1.5
}
```

**Response:**

```json
{
  "base_date": "2026-07-02",
  "forecasts": [
    { "day_offset": 0, "date": "2026-07-02", "avg_temp": 29.1 },
    { "day_offset": 1, "date": "2026-07-03", "avg_temp": 29.4 },
    { "day_offset": 2, "date": "2026-07-04", "avg_temp": 29.8 }
  ],
  "resolved": { "month": "July", "season": "Monsoon", "elevation": 5.0, "latitude": 22.5333, "longitude": 88.3333 }
}
```

Returns **503** if forecaster models are not loaded — run `train_forecaster.py`
and redeploy with `api/models/forecaster/` committed.
