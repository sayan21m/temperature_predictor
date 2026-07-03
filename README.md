# India Temperature Predictor 🌤️

An end-to-end machine learning project that explores decades of Indian weather
data and predicts average, minimum and maximum temperature for any station in
India — combining live weather conditions with a trained
`HistGradientBoostingRegressor` model served from a real API.

**Live demo:** [sayan21m.github.io/temperature_predictor](https://sayan21m.github.io/temperature_predictor/) · [Prediction tool](https://sayan21m.github.io/temperature_predictor/prediction.html)

## What this project does

1. **Explores** ~400 weather stations across India (temperature, rainfall,
   wind speed, air pressure, elevation, season) via a full EDA pass —
   missing-value analysis, distributions, correlations, outliers, seasonal
   and geographic trends.
2. **Trains** a multi-target regression model (`avg_temp`, `min_temp`,
   `max_temp`) using time-based train/test splits to avoid data leakage, and
   benchmarks it against CatBoost.
3. **Serves** the trained model from a FastAPI backend deployed on Render.
4. **Visualizes** the whole dataset in an interactive dashboard, and lets
   anyone predict temperature for a real Indian station — auto-filling live
   weather from Open-Meteo, or entering values manually.

## Architecture

```
india_weather_rainfall_data.xlsx
        │
        ▼
data_analysis/            EDA + model training + benchmarking (Jupyter)
        │
        ├──▶ docs/data.json         pre-aggregated stats consumed by the dashboard
        │
        └──▶ api/models/*.joblib    trained pipelines, served by the API
                    │
                    ▼
        api/ (FastAPI, deployed on Render)
                    │
                    ▼  POST /predict
        docs/ (static site, deployed on GitHub Pages)
          ├─ index.html        EDA dashboard (Plotly)
          └─ prediction.html   live temperature predictor
```

The frontend is a static site (GitHub Pages can't run Python), so predictions
are served by a small FastAPI backend hosted separately on Render. If that
backend is unreachable, the prediction button shows an error instead of
returning a substitute estimate.

## Tech stack

| Layer | Tools |
| --- | --- |
| Data analysis / ML | Python, pandas, NumPy, scikit-learn, CatBoost, seaborn/matplotlib, Jupyter |
| API | FastAPI, uvicorn, joblib, Pydantic |
| Frontend | HTML, Tailwind CSS, vanilla JS, Plotly.js |
| Hosting | GitHub Pages (frontend), Render (API) |

## Repository structure

```
data_analysis/
  eda.ipynb                 exploratory data analysis
  data_preprocessing.ipynb  cleaning / feature engineering
  analysis.ipynb            model training, benchmarking, sample predictions
  json_dumper.ipynb         builds docs/data.json for the dashboard
  eda_pipeline.py           standalone EDA script
  json_dumper_pipeline.py   standalone script that regenerates docs/data.json

api/
  main.py                   FastAPI app (GET /health, POST /predict)
  train_model.py            trains & pickles the models used by main.py
  models/                   committed, pre-trained model artifacts (~2.5 MB)
  requirements.txt
  README.md                 API setup + Render deployment guide

docs/                       static site (GitHub Pages root)
  index.html                EDA dashboard
  prediction.html           temperature predictor UI
  prediction.js
  data.json                 pre-aggregated stats for the dashboard

render.yaml                 Render Blueprint for the API service
```

## Running it locally

**Frontend:**

```bash
npm install
npm run serve      # serves docs/ at http://localhost:8080
```

**API** (required for predictions — the frontend calls `POST /predict`):

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train_model.py          # trains + pickles the models (run once)
uvicorn main:app --reload --port 8000
```

Then update `PREDICTION_API_BASE_URL` in `docs/prediction.js` to
`http://localhost:8000` while testing locally. Full deployment instructions
(Render + GitHub Pages) are in [`api/README.md`](api/README.md).

## Model performance

Holdout evaluation on a 2024+ time-based split — trained with 800k+ rows and
never seeing the test period during training (see `data_analysis/analysis.ipynb`
and [`api/models/metadata.json`](api/models/metadata.json) for the full numbers):

| Target | MAE | RMSE | R² |
| --- | --- | --- | --- |
| `avg_temp` | 1.29°C | 1.70°C | 0.91 |
| `min_temp` | 1.41°C | 1.89°C | 0.91 |
| `max_temp` | 1.66°C | 2.19°C | 0.85 |

## Known limitations

- Open-Meteo is used directly in the browser for live weather inputs and lag
  features — no API key required.
- The Render free plan spins the API down after 15 minutes of inactivity, so
  the first prediction after a while can take 30-50 seconds ("cold start").
  The UI shows a loading hint while waiting; if the API is still unavailable,
  prediction fails with an error message.
- `india_weather_rainfall_data.xlsx` (~62 MB) is the original raw dataset,
  included for full reproducibility of the analysis.

## License

[MIT](LICENSE)
