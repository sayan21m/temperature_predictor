// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Deployed FastAPI backend that serves the real trained model (see api/main.py).
// Replace with your own Render service URL after deploying the api/ folder
// (see api/README.md).
const PREDICTION_API_BASE_URL = 'https://temperature-predictor-blrm.onrender.com';

// Demo OpenWeather key so live weather "just works" without asking visitors
// to sign up for their own account.
const OWM_API_KEY = '654d34ce81a03e3885a61327d46270f1';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadData() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
    try {
        const response = await fetch('./data.json');
        return await response.json();
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

function isDark() {
    return document.documentElement.classList.contains('dark');
}

function themeLayout(layout = {}) {
    const dark = isDark();
    const grid = dark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.10)';
    layout.paper_bgcolor = 'rgba(0,0,0,0)';
    layout.plot_bgcolor = 'rgba(0,0,0,0)';
    layout.font = Object.assign({ color: dark ? '#cbd5e1' : '#334155' }, layout.font);
    layout.xaxis = Object.assign({ gridcolor: grid, zerolinecolor: grid }, layout.xaxis);
    layout.yaxis = Object.assign({ gridcolor: grid, zerolinecolor: grid }, layout.yaxis);
    return layout;
}

const plotlyConfig = {
    scrollZoom: true,
    responsive: true,
    modeBarButtonsToRemove: ['zoom2d', 'select2d', 'lasso2d'],
    displaylogo: false
};

window.applyPredictionChartTheme = function () {
    if (typeof Plotly === 'undefined') return;
    const el = document.getElementById('comparisonChart');
    if (!el || !el.data) return;
    const dark = isDark();
    const grid = dark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.10)';
    try {
        Plotly.relayout(el, {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            'font.color': dark ? '#cbd5e1' : '#334155',
            'xaxis.gridcolor': grid,
            'yaxis.gridcolor': grid,
            'xaxis.zerolinecolor': grid,
            'yaxis.zerolinecolor': grid
        });
    } catch (e) { /* chart not rendered yet */ }
};

// ---------------------------------------------------------------------------
// UX helpers
// ---------------------------------------------------------------------------

function showToast(message, type = 'info') {
    const palette = {
        info: { bg: '#0e7490', border: '#22d3ee' },
        success: { bg: '#15803d', border: '#4ade80' },
        warning: { bg: '#b45309', border: '#fbbf24' },
        error: { bg: '#b91c1c', border: '#f87171' }
    };
    const { bg, border } = palette[type] || palette.info;

    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText =
            'position:fixed;bottom:1rem;right:1rem;z-index:10000;display:flex;' +
            'flex-direction:column;gap:0.5rem;max-width:min(90vw,22rem);';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText =
        `background:${bg};color:#fff;border-left:4px solid ${border};` +
        'padding:0.75rem 1rem;border-radius:0.75rem;font-size:0.875rem;line-height:1.3;' +
        'box-shadow:0 10px 25px rgba(0,0,0,0.35);opacity:0;transform:translateY(8px);' +
        'transition:opacity .25s ease, transform .25s ease;';
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        setTimeout(() => toast.remove(), 250);
    }, 4000);
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

const TARGET_COLS = ['avg_temp', 'min_temp', 'max_temp'];
const FEATURE_COLS = ['rainfall', 'wind_speed', 'air_pressure'];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// matches the season actually assigned per month in india_weather_rainfall_data.xlsx
// (NOT the standard IMD Mar-May "summer" convention: this dataset's Winter runs
// through March, and Summer starts in April)
function seasonFromMonth(month1to12) {
    if ([12, 1, 2, 3].includes(month1to12)) return 'Winter';
    if ([4, 5, 6].includes(month1to12)) return 'Summer';
    if ([7, 8, 9].includes(month1to12)) return 'Monsoon';
    return 'Post-monsoon';
}

// walks state -> district -> station -> season, falling back to the
// coarsest level available so a prediction is always possible
function resolveClimatology(data, stateName, districtName, stationName, season) {
    const stateData = data.kpi_data[stateName];
    if (!stateData) return null;

    const districtData = districtName ? stateData.district[districtName] : null;
    const stationData = districtData && stationName ? districtData.station_name[stationName] : null;

    if (stationData) {
        const seasonal = stationData.season && stationData.season[season];
        if (seasonal) return { data: seasonal, level: `${stationName} · ${season}` };
        return { data: stationData, level: `${stationName} (all seasons)` };
    }
    if (districtData) return { data: districtData, level: `${districtName} district average` };
    return { data: stateData, level: `${stateName} state average` };
}

function corrBetween(data, a, b) {
    const cols = data.corr.columns;
    const i = cols.indexOf(a);
    const j = cols.indexOf(b);
    if (i === -1 || j === -1) return 0;
    return data.corr.values[i][j];
}

function getStatsRow(data, indexName) {
    return data.stats.find((row) => row.index === indexName) || {};
}

// climate-normal baseline + linear nudge from the correlation/std relationship
// measured across the whole dataset for rainfall, wind speed and air pressure
function predictTemperatures(data, climatology, inputs) {
    const std = getStatsRow(data, 'std');
    const result = {};

    for (const target of TARGET_COLS) {
        let value = climatology[target];
        for (const feature of FEATURE_COLS) {
            const corr = corrBetween(data, target, feature);
            const slope = std[feature] ? corr * (std[target] / std[feature]) : 0;
            value += slope * (inputs[feature] - climatology[feature]);
        }
        result[target] = value;
    }

    // keep the three values in a sensible order for display
    if (result.min_temp > result.avg_temp) result.min_temp = result.avg_temp;
    if (result.max_temp < result.avg_temp) result.max_temp = result.avg_temp;

    return result;
}

function guessCityFromStation(stationName) {
    if (!stationName) return '';
    return stationName.split('/')[0].trim();
}

function formatDelta(predicted, normal) {
    const diff = predicted - normal;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)}°C vs. seasonal normal (${normal.toFixed(1)}°C)`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    let data;
    try {
        data = await loadData();
    } catch (err) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;height:100vh;padding:1.5rem;text-align:center;font-family:sans-serif;background:#0f172a;color:#cbd5e1;">
                <h2 style="color:#f87171;margin:0;">⚠️ Failed to load climate data</h2>
                <p style="margin:0;">Make sure <code>data.json</code> exists next to <code>prediction.html</code> in the <code>docs/</code> folder.</p>
                <pre style="max-width:90vw;overflow:auto;color:#fca5a5;background:#1e293b;padding:0.75rem 1rem;border-radius:0.5rem;">${err.message}</pre>
            </div>`;
        return;
    }

    // ----- elements -----
    const stateSelect = document.getElementById('stateSelect');
    const districtSelect = document.getElementById('districtSelect');
    const stationSelect = document.getElementById('stationSelect');
    const dateInput = document.getElementById('dateInput');
    const monthBadge = document.getElementById('monthBadge');
    const seasonBadge = document.getElementById('seasonBadge');
    const climatologySourceNote = document.getElementById('climatologySourceNote');

    const cityInput = document.getElementById('cityInput');
    const fetchWeatherBtn = document.getElementById('fetchWeatherBtn');
    const weatherFetchStatus = document.getElementById('weatherFetchStatus');
    const predictionSourceNote = document.getElementById('predictionSourceNote');

    const rainfallInput = document.getElementById('rainfallInput');
    const windSpeedInput = document.getElementById('windSpeedInput');
    const pressureInput = document.getElementById('pressureInput');
    const rainfallHint = document.getElementById('rainfallHint');
    const windSpeedHint = document.getElementById('windSpeedHint');
    const pressureHint = document.getElementById('pressureHint');
    const resetInputsBtn = document.getElementById('resetInputsBtn');

    const predictBtn = document.getElementById('predictBtn');
    const resultsSection = document.getElementById('resultsSection');
    const avgTempResult = document.getElementById('avgTempResult');
    const minTempResult = document.getElementById('minTempResult');
    const maxTempResult = document.getElementById('maxTempResult');
    const avgTempDelta = document.getElementById('avgTempDelta');
    const minTempDelta = document.getElementById('minTempDelta');
    const maxTempDelta = document.getElementById('maxTempDelta');

    const fieldEls = { rainfall: rainfallInput, wind_speed: windSpeedInput, air_pressure: pressureInput };
    const fieldHints = { rainfall: rainfallHint, wind_speed: windSpeedHint, air_pressure: pressureHint };
    const fieldSource = { rainfall: 'climatology', wind_speed: 'climatology', air_pressure: 'climatology' };

    // ----- default date = today -----
    const today = new Date();
    dateInput.value = today.toISOString().slice(0, 10);

    // ----- populate state dropdown -----
    const stateNames = Object.keys(data.kpi_data).sort();
    stateSelect.innerHTML = ['<option disabled selected value="">Select state</option>',
        ...stateNames.map((s) => `<option value="${s}">${s}</option>`)].join('');

    function currentSeason() {
        const [, month] = dateInput.value.split('-').map(Number);
        return seasonFromMonth(month);
    }

    function updateResolvedBadges() {
        const [, month] = dateInput.value.split('-').map(Number);
        const season = seasonFromMonth(month);
        monthBadge.textContent = `Month ${MONTH_NAMES[month - 1]}`;
        seasonBadge.textContent = `Season ${season}`;
        return season;
    }

    function currentClimatology() {
        if (!stateSelect.value) return null;
        const season = updateResolvedBadges();
        return resolveClimatology(data, stateSelect.value, districtSelect.value, stationSelect.value, season);
    }

    // fills the three weather fields from climatology, unless the user (or
    // OpenWeather) already supplied a value for that specific field
    function refreshClimatologyDefaults() {
        const resolved = currentClimatology();
        if (!resolved) return;

        climatologySourceNote.textContent = `Using ${resolved.level} normals`;

        FEATURE_COLS.forEach((feature) => {
            const value = resolved.data[feature];
            fieldHints[feature].textContent = `avg ${value.toFixed(1)}`;
            if (fieldSource[feature] === 'climatology') {
                fieldEls[feature].value = value.toFixed(1);
            }
        });
    }

    function markFieldDirty(feature, source) {
        fieldSource[feature] = source;
    }

    FEATURE_COLS.forEach((feature) => {
        fieldEls[feature].addEventListener('input', () => markFieldDirty(feature, 'manual'));
    });

    resetInputsBtn.addEventListener('click', () => {
        FEATURE_COLS.forEach((feature) => markFieldDirty(feature, 'climatology'));
        refreshClimatologyDefaults();
        weatherFetchStatus.textContent = '';
        showToast('Weather inputs reset to the seasonal average.', 'info');
    });

    stateSelect.addEventListener('change', () => {
        const districts = Object.keys(data.kpi_data[stateSelect.value].district).sort();
        districtSelect.innerHTML = ['<option disabled selected value="">Select district</option>',
            ...districts.map((d) => `<option value="${d}">${d}</option>`)].join('');
        districtSelect.disabled = false;

        stationSelect.innerHTML = '<option disabled selected value="">Select station</option>';
        stationSelect.disabled = true;
        predictBtn.disabled = true;
        resultsSection.classList.add('hidden');

        refreshClimatologyDefaults();
    });

    districtSelect.addEventListener('change', () => {
        const districtData = data.kpi_data[stateSelect.value].district[districtSelect.value];
        const stations = Object.keys(districtData.station_name).sort();
        stationSelect.innerHTML = ['<option disabled selected value="">Select station</option>',
            ...stations.map((s) => `<option value="${s}">${s}</option>`)].join('');
        stationSelect.disabled = false;
        predictBtn.disabled = true;
        resultsSection.classList.add('hidden');

        refreshClimatologyDefaults();
    });

    stationSelect.addEventListener('change', () => {
        predictBtn.disabled = false;
        refreshClimatologyDefaults();

        const guessedCity = guessCityFromStation(stationSelect.value);
        if (guessedCity && guessedCity !== cityInput.value) {
            cityInput.value = guessedCity;
        }
        fetchWeather(cityInput.value, { silent: true });
    });

    dateInput.addEventListener('change', () => {
        updateResolvedBadges();
        refreshClimatologyDefaults();
    });

    updateResolvedBadges();

    // ----- automatic live weather (no API key/URL ever shown to the user) -----
    let weatherDebounceTimer = null;

    async function fetchWeather(cityRaw, { silent = false } = {}) {
        const city = (cityRaw || '').trim();
        if (!city) return;

        fetchWeatherBtn.disabled = true;
        if (!silent) weatherFetchStatus.textContent = 'Fetching live weather…';

        try {
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)},IN&units=metric&appid=${OWM_API_KEY}`;
            const res = await fetch(url);
            const json = await res.json();

            if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);

            const pressure = json.main?.pressure;
            const wind = json.wind?.speed;
            const rain = (json.rain && (json.rain['1h'] ?? json.rain['3h'])) ?? 0;
            const temp = json.main?.temp;
            const desc = json.weather?.[0]?.description ?? '';

            if (typeof rain === 'number') { rainfallInput.value = rain.toFixed(1); markFieldDirty('rainfall', 'openweather'); }
            if (typeof wind === 'number') { windSpeedInput.value = wind.toFixed(1); markFieldDirty('wind_speed', 'openweather'); }
            if (typeof pressure === 'number') { pressureInput.value = pressure.toFixed(1); markFieldDirty('air_pressure', 'openweather'); }

            const stamp = new Date().toLocaleTimeString();
            weatherFetchStatus.textContent =
                `Live for ${json.name || city}: ${temp?.toFixed(1)}°C, ${desc} · pressure ${pressure} hPa · wind ${wind} m/s · rain ${rain.toFixed(1)} mm (as of ${stamp})`;
            if (!silent) showToast('Live weather updated.', 'success');
        } catch (err) {
            if (!silent) showToast(`Could not fetch live weather: ${err.message}`, 'error');
            weatherFetchStatus.textContent = 'Could not fetch live weather for this city — using seasonal values instead.';
        } finally {
            fetchWeatherBtn.disabled = false;
        }
    }

    fetchWeatherBtn.addEventListener('click', () => fetchWeather(cityInput.value));

    cityInput.addEventListener('input', () => {
        clearTimeout(weatherDebounceTimer);
        weatherDebounceTimer = setTimeout(() => fetchWeather(cityInput.value, { silent: true }), 900);
    });

    // ----- prediction -----
    function renderComparisonChart(climatology, predicted) {
        const categories = ['Average', 'Minimum', 'Maximum'];
        const normalValues = [climatology.avg_temp, climatology.min_temp, climatology.max_temp];
        const predictedValues = [predicted.avg_temp, predicted.min_temp, predicted.max_temp];

        const traces = [
            { x: categories, y: normalValues, type: 'bar', name: 'Seasonal normal', marker: { color: 'rgb(148,163,184)' } },
            { x: categories, y: predictedValues, type: 'bar', name: 'Prediction', marker: { color: 'rgb(6,182,212)' } }
        ];

        const layout = {
            barmode: 'group',
            margin: { t: 20 },
            yaxis: { title: 'Temperature (°C)' },
            legend: { orientation: 'h', y: -0.15 }
        };

        Plotly.react('comparisonChart', traces, themeLayout(layout), plotlyConfig);
    }

    // calls the real trained model behind the hosted backend; throws on any
    // network error, non-2xx response, or timeout so the caller can fall back.
    // Render's free plan spins the service down after inactivity, so a "cold
    // start" can take up to ~30-50s — the timeout below accommodates that.
    async function predictViaApi(inputs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);

        try {
            const res = await fetch(`${PREDICTION_API_BASE_URL}/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    state: stateSelect.value,
                    district: districtSelect.value,
                    station_name: stationSelect.value,
                    date: dateInput.value,
                    rainfall: inputs.rainfall,
                    wind_speed: inputs.wind_speed,
                    air_pressure: inputs.air_pressure
                })
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.detail ? JSON.stringify(body.detail) : `API returned ${res.status}`);
            }

            const json = await res.json();
            return { avg_temp: json.avg_temp, min_temp: json.min_temp, max_temp: json.max_temp };
        } finally {
            clearTimeout(timeout);
        }
    }

    predictBtn.addEventListener('click', async () => {
        const resolved = currentClimatology();
        if (!resolved) { showToast('Select a state, district and station first.', 'warning'); return; }

        const inputs = {
            rainfall: parseFloat(rainfallInput.value) || 0,
            wind_speed: parseFloat(windSpeedInput.value) || 0,
            air_pressure: parseFloat(pressureInput.value) || 0
        };

        const climatology = resolved.data;

        predictBtn.disabled = true;
        predictBtn.textContent = 'Predicting…';
        const wakingUpTimer = setTimeout(() => { predictBtn.textContent = 'Waking up model…'; }, 4000);

        let predicted;
        try {
            predicted = await predictViaApi(inputs);
            predictionSourceNote.textContent = 'Predicted using our trained machine learning model.';
            showToast('Prediction ready.', 'success');
        } catch {
            predicted = predictTemperatures(data, climatology, inputs);
            predictionSourceNote.textContent = 'Predicted using seasonal climate normals (estimate).';
            showToast('Prediction ready.', 'success');
        } finally {
            clearTimeout(wakingUpTimer);
            predictBtn.disabled = false;
            predictBtn.textContent = 'Predict temperature';
        }

        avgTempResult.textContent = `${predicted.avg_temp.toFixed(1)} °C`;
        minTempResult.textContent = `${predicted.min_temp.toFixed(1)} °C`;
        maxTempResult.textContent = `${predicted.max_temp.toFixed(1)} °C`;

        avgTempDelta.textContent = formatDelta(predicted.avg_temp, climatology.avg_temp);
        minTempDelta.textContent = formatDelta(predicted.min_temp, climatology.min_temp);
        maxTempDelta.textContent = formatDelta(predicted.max_temp, climatology.max_temp);

        resultsSection.classList.remove('hidden');
        renderComparisonChart(climatology, predicted);
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

main();
