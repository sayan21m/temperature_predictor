# India Temperature Predictor 🌤️

An end-to-end machine learning project that explores decades of Indian weather
data and predicts temperature for any station in India — same-day average,
minimum and maximum from one model, plus a **7-day average-temperature outlook**
from a chained multi-horizon forecaster. Live weather from Open-Meteo is sent
to a FastAPI backend on Render.

**Live demo:** [sayan21m.github.io/temperature_predictor](https://sayan21m.github.io/temperature_predictor/) · [Prediction tool](https://sayan21m.github.io/temperature_predictor/prediction.html)

**Developer docs:** [DEVELOPMENT.md](DEVELOPMENT.md) — full architecture, training, API, frontend, deployment, and extension guide (export to PDF via Pandoc or your editor).

## What this project does

1. **Explores** ~400 weather stations across India (temperature, rainfall,
   wind speed, air pressure, elevation, season) via a full EDA pass —
   missing-value analysis, distributions, correlations, outliers, seasonal
   and geographic trends.
2. **Trains** two model families on a 2024+ holdout split:
   - **Same-day** (`avg_temp`, `min_temp`, `max_temp`) — `HistGradientBoostingRegressor`
   - **Multi-day outlook** (day 0–6 average temp) — chained `LGBMRegressor` models
3. **Serves** both from a FastAPI backend deployed on Render (`POST /predict`,
   `POST /forecast`).
4. **Visualizes** the dataset in an interactive dashboard and lets anyone pick a
   station, auto-fill live weather from Open-Meteo, and view same-day
   predictions plus a 7-day line chart.

## Architecture

```
india_weather_rainfall_data.xlsx
        │
        ▼
data_analysis/               EDA + model training (Jupyter)
  analysis.ipynb             same-day avg / min / max
  forcaster_model.ipynb      7-day chained forecast
        │
        ├──▶ docs/data.json              dashboard aggregates
        │
        ├──▶ api/models/*.joblib         same-day models (HistGradientBoosting)
        └──▶ api/models/forecaster/      7-day models (LightGBM, chained)
                    │
                    ▼
        api/ (FastAPI on Render)
          POST /predict    same-day avg, min, max
          POST /forecast   7-day avg-temp outlook
                    │
                    ▼
        docs/ (GitHub Pages)
          index.html         EDA dashboard (Plotly)
          prediction.html    predictor UI + charts
```

The frontend is static (GitHub Pages cannot run Python), so all ML inference
happens on Render. If the API is unreachable, the predict button shows an
error — there is no offline fallback.

## Tech stack

| Layer | Tools |
| --- | --- |
| Data analysis / ML | Python, pandas, NumPy, scikit-learn, LightGBM, CatBoost, seaborn/matplotlib, Jupyter |
| API | FastAPI, uvicorn, joblib, Pydantic |
| Frontend | HTML, Tailwind CSS, vanilla JS, Plotly.js, Open-Meteo |
| Hosting | GitHub Pages (frontend), Render (API) |

## Repository structure

```
data_analysis/
  eda.ipynb                 exploratory data analysis
  data_preprocessing.ipynb  cleaning / feature engineering
  analysis.ipynb            same-day model training + benchmarking
  forcaster_model.ipynb     7-day chained forecast model
  json_dumper.ipynb         builds docs/data.json for the dashboard
  eda_pipeline.py           standalone EDA script
  json_dumper_pipeline.py   regenerates docs/data.json

api/
  main.py                   FastAPI (GET /health, POST /predict, POST /forecast)
  train_model.py            trains same-day models → api/models/
  train_forecaster.py       trains 7-day models → api/models/forecaster/
  models/                   committed model artifacts (~35 MB total)
  requirements.txt
  README.md                 API setup + Render deployment

docs/                       GitHub Pages site root
  index.html                EDA dashboard
  prediction.html           predictor UI
  prediction.js             Open-Meteo + API client
  data.json                 pre-aggregated stats for the dashboard

render.yaml                 Render Blueprint for the API service
```

## Running it locally

**Frontend:**

```bash
npm install
npm run serve      # http://localhost:8080
```

**API** (required for predictions):

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train_model.py          # same-day models (run once)
python train_forecaster.py     # 7-day forecaster (run once; needs the .xlsx)
uvicorn main:app --reload --port 8000
```

Point `PREDICTION_API_BASE_URL` in `docs/prediction.js` at `http://localhost:8000`
while testing locally. Full deployment steps are in [`api/README.md`](api/README.md).

## Model performance

Holdout evaluation on data from **2024-01-01** onward (train on earlier years only).
Full numbers live in `api/models/metadata.json` and
`api/models/forecaster/metadata.json`.

### Same-day (`HistGradientBoostingRegressor`)

| Target | MAE | RMSE | R² |
| --- | --- | --- | --- |
| `avg_temp` | 0.67°C | 0.95°C | 0.97 |
| `min_temp` | 0.97°C | 1.32°C | 0.96 |
| `max_temp` | 1.01°C | 1.40°C | 0.94 |

### 7-day outlook (`LGBMRegressor`, chained from day 2)

| Horizon | MAE | RMSE | R² |
| --- | --- | --- | --- |
| Day 0 (`avg_temp`) | 0.66°C | 0.93°C | 0.97 |
| Day +1 | 0.96°C | 1.30°C | 0.95 |
| Day +2 | 1.19°C | 1.62°C | 0.92 |
| Day +3 | 1.31°C | 1.79°C | 0.90 |
| Day +4 | 1.38°C | 1.87°C | 0.90 |
| Day +5 | 1.41°C | 1.91°C | 0.89 |
| Day +6 | 1.43°C | 1.94°C | 0.89 |

## Known limitations

- Open-Meteo is called from the browser for live inputs and historical lag
  features (bulk fetch for the 14 days before the selected date). No API key
  required.
- The Render free plan spins the API down after ~15 minutes of inactivity; the
  first request after that can take 30–50 seconds. The UI pings `/health` on load
  and shows “Waking up model…” while waiting.
- The 7-day chart needs `api/models/forecaster/` deployed on Render. If those
  artifacts are missing, same-day `/predict` still works and the UI shows a
  warning for the outlook chart.
- `india_weather_rainfall_data.xlsx` (~62 MB) is the raw dataset, included for
  full reproducibility. It is **not** needed at Render runtime if models are
  committed.

## License

[MIT](LICENSE)
