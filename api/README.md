# Temperature Predictor API

A small FastAPI server that loads the real trained models (pickled with
`joblib`) and serves predictions to `docs/prediction.html`. This exists
because a static GitHub Pages site can't run a Python model on its own —
the JS-only fallback in `docs/prediction.js` is a statistical approximation,
not the trained model.

## Setup

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 1. Train and pickle the models

Run this once (and again whenever `india_weather_rainfall_data.xlsx`
changes). It reproduces the feature engineering from
`data_analysis/analysis.ipynb` (year / sin_day / cos_day, no `min_temp` /
`max_temp` leakage) and trains one `HistGradientBoostingRegressor` pipeline
per target.

```bash
python train_model.py
```

This writes to `api/models/`:

- `avg_temp_model.joblib`, `min_temp_model.joblib`, `max_temp_model.joblib`
- `station_lookup.json` — elevation/latitude/longitude per station, so the
  API can fill those in without the frontend having to send them
- `metadata.json` — feature/target column order and holdout metrics

`api/models/` is committed to git (it's only ~2.5 MB) so Render can serve
predictions immediately without needing the 60+ MB Excel file or a training
step at deploy time. Re-run `train_model.py` and commit the updated files
whenever you retrain.

## 2. Run the server locally

```bash
uvicorn main:app --reload --port 8000
```

Check it's alive:

```bash
curl http://localhost:8000/health
```

## 3. Deploy to Render

The API lives in the `api/` subfolder of the repo. Render supports
monorepos natively via a **Root Directory** setting, so no subtree pushing
or extra tooling is needed — just deploy straight from your GitHub repo.

### Option A: Blueprint (recommended)

The repo root already has a `render.yaml` describing the service
(`rootDir: api`, build/start commands, health check). In the
[Render Dashboard](https://dashboard.render.com), click **New +** →
**Blueprint**, connect this repo, and Render will pick up `render.yaml`
automatically.

### Option B: Manual web service

**New +** → **Web Service** → connect this repo, then set:

| Setting | Value |
| --- | --- |
| Root Directory | `api` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |

Render reads the Python version from `api/.python-version` automatically.

Once it's deployed:

```bash
curl https://your-service-name.onrender.com/health
```

Every push to your connected branch redeploys automatically — no manual
redeploy step needed.

> **Free plan note:** Render spins down free web services after 15 minutes
> of inactivity. The first request after that ("cold start") can take
> 30-50 seconds. `docs/prediction.js` already uses a generous 45s timeout
> and shows a "Waking up model…" hint on the predict button, then falls
> back to the offline estimate if it's still not ready. Upgrade to a paid
> instance type to avoid cold starts entirely.

### Locking down CORS (optional but recommended)

By default the API accepts requests from any origin (`allow_origins=["*"]`)
so the demo works immediately. Once your GitHub Pages site is live, restrict
it in the Render Dashboard under your service's **Environment** tab:

```
ALLOWED_ORIGINS=https://<your-github-username>.github.io
```

(or edit the `ALLOWED_ORIGINS` value in `render.yaml` if using the Blueprint).

## 4. Point the frontend at your deployed API

Open `docs/prediction.js` and update the constant near the top of the file:

```js
const PREDICTION_API_BASE_URL = 'https://your-service-name.onrender.com';
```

The frontend never shows this URL (or any API key) in the UI — predictions
happen automatically and silently against this backend. If it's ever
unreachable, the page falls back to an offline seasonal-normal estimate
without exposing any technical details to the visitor.

## API

### `POST /predict`

```json
{
  "state": "West Bengal",
  "district": "Kolkata",
  "station_name": "Calcutta / Alipore",
  "date": "2026-07-02",
  "rainfall": 5.2,
  "wind_speed": 8.0,
  "air_pressure": 999.0
}
```

`state` / `district` / `station_name` must match the dataset's categories
exactly (these are the same values the `docs/prediction.html` dropdowns are
built from, via `docs/data.json`).

Response:

```json
{
  "avg_temp": 29.1,
  "min_temp": 25.8,
  "max_temp": 33.4,
  "resolved": { "month": "July", "season": "Monsoon", "elevation": 5.0, "latitude": 22.5333, "longitude": 88.3333 }
}
```
