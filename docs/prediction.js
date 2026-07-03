// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PREDICTION_API_BASE_URL = 'https://temperature-predictor-blrm.onrender.com';
const API_TIMEOUT_MS = 45000;
let data;

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
    responsive: true,
    displayModeBar: false
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

const FEATURE_COLS = ['rainfall', 'wind_speed', 'air_pressure'];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// analysis.ipynb trains on spreadsheet state codes; data.json dropdowns use full names.
const STATE_FULL_TO_CODE = {
    'Jammu and Kashmir': 'JK', 'Punjab': 'PB', 'Himachal Pradesh': 'HP', 'Haryana': 'HR',
    'Chandigarh': 'CH', 'Uttar Pradesh': 'UP', 'Rajasthan': 'RJ', 'Delhi': 'DL',
    'Arunachal Pradesh': 'AR', 'West Bengal': 'WB', 'Sikkim': 'SK', 'Assam': 'AS',
    'Madhya Pradesh': 'MP', 'Bihar': 'BR', 'Meghalaya': 'ML', 'Nagaland': 'NL',
    'Gujarat': 'GJ', 'Tripura': 'TR', 'Manipur': 'MN', 'Mizoram': 'MZ', 'Odisha': 'OR',
    'Maharashtra': 'MH', 'Chhattisgarh': 'CT', 'Daman and Diu': 'DD', 'Karnataka': 'KA',
    'Andhra Pradesh': 'AP', 'Goa': 'GA', 'Tamil Nadu': 'TN', 'Lakshadweep': 'LD',
    'Andaman and Nicobar Islands': 'AN', 'Kerala': 'KL', 'Puducherry': 'PY'
};

function resolveStateCode(stateName) {
    return STATE_FULL_TO_CODE[stateName] || stateName;
}

function seasonFromMonth(month1to12) {
    if ([12, 1, 2, 3].includes(month1to12)) return 'Winter';
    if ([4, 5, 6].includes(month1to12)) return 'Summer';
    if ([7, 8, 9].includes(month1to12)) return 'Monsoon';
    return 'Post-monsoon';
}

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

function guessCityFromStation(stationName) {
    if (!stationName) return '';
    return stationName.split('/')[0].trim();
}

function formatDelta(predicted, normal) {
    const diff = predicted - normal;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)}°C vs. seasonal normal (${normal.toFixed(1)}°C)`;
}

function parseOptionalNumber(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Weather (Open-Meteo) — live inputs and lag features
// ---------------------------------------------------------------------------

const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_HOURLY = 'temperature_2m,precipitation,wind_speed_10m,surface_pressure';

function localTodayIso() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

function isoDateOffset(baseDateStr, daysBack) {
    const [year, month, day] = baseDateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day - daysBack);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function getCoordinates(stationName) {
    const station = data.lat_long.find((i) => i.station_name === stationName);
    if (!station) return null;
    return [station.latitude, station.longitude];
}

function meanOf(values) {
    const nums = values.filter((v) => v != null && Number.isFinite(v));
    if (!nums.length) return null;
    return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

async function fetchOpenMeteoJson(url) {
    const res = await fetch(url);
    let json;
    try {
        json = await res.json();
    } catch {
        throw new Error(`Open-Meteo returned an unreadable response (HTTP ${res.status})`);
    }
    if (!res.ok || json.error) {
        throw new Error(json.reason || `Open-Meteo request failed (HTTP ${res.status})`);
    }
    return json;
}

function aggregateHourlyWeather(hourly, date) {
    const times = hourly.time || [];
    const temps = hourly.temperature_2m || [];
    const rains = hourly.precipitation || [];
    const winds = hourly.wind_speed_10m || [];
    const pressures = hourly.surface_pressure || [];

    const tempValues = [];
    const rainValues = [];
    const windValues = [];
    const pressureValues = [];

    for (let i = 0; i < times.length; i++) {
        if (!String(times[i]).startsWith(date)) continue;
        if (temps[i] != null && Number.isFinite(temps[i])) tempValues.push(temps[i]);
        if (rains[i] != null && Number.isFinite(rains[i])) rainValues.push(rains[i]);
        if (winds[i] != null && Number.isFinite(winds[i])) windValues.push(winds[i]);
        if (pressures[i] != null && Number.isFinite(pressures[i])) pressureValues.push(pressures[i]);
    }

    if (!tempValues.length) throw new Error(`No temperature data for ${date}`);

    const windSpeed = meanOf(windValues);
    const pressure = meanOf(pressureValues);
    if (windSpeed == null) throw new Error(`No wind data for ${date}`);
    if (pressure == null) throw new Error(`No pressure data for ${date}`);

    return {
        min: Math.min(...tempValues),
        max: Math.max(...tempValues),
        avg: meanOf(tempValues),
        rain: rainValues.reduce((sum, v) => sum + v, 0),
        wind_speed: windSpeed,
        pressure
    };
}

function buildOpenMeteoUrl(baseUrl, lat, lon, date) {
    const params = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lon),
        hourly: OPEN_METEO_HOURLY,
        wind_speed_unit: 'ms',
        timezone: 'auto',
        start_date: date,
        end_date: date
    });
    return `${baseUrl}?${params}`;
}

async function fetchHourlyWeather(lat, lon, date) {
    const forecastUrl = buildOpenMeteoUrl(OPEN_METEO_FORECAST, lat, lon, date);
    try {
        const json = await fetchOpenMeteoJson(forecastUrl);
        return aggregateHourlyWeather(json.hourly, date);
    } catch (forecastErr) {
        const archiveUrl = buildOpenMeteoUrl(OPEN_METEO_ARCHIVE, lat, lon, date);
        try {
            const json = await fetchOpenMeteoJson(archiveUrl);
            return aggregateHourlyWeather(json.hourly, date);
        } catch (archiveErr) {
            throw new Error(archiveErr.message || forecastErr.message);
        }
    }
}

async function geocodeCity(city) {
    const params = new URLSearchParams({
        name: city,
        count: '1',
        language: 'en',
        format: 'json'
    });
    const json = await fetchOpenMeteoJson(`${OPEN_METEO_GEOCODE}?${params}`);
    const hit = json.results && json.results[0];
    if (!hit) throw new Error(`Could not find coordinates for "${city}"`);
    return { lat: hit.latitude, lon: hit.longitude, label: hit.name };
}

async function resolveWeatherLocation(station, cityFallback = '') {
    const coords = station ? getCoordinates(station) : null;
    if (coords) {
        return { lat: coords[0], lon: coords[1], label: station };
    }

    const city = (cityFallback || '').trim();
    if (!city) return null;

    const geo = await geocodeCity(city);
    return { lat: geo.lat, lon: geo.lon, label: geo.label };
}

async function getStationWeather(station, date, cityFallback = '') {
    const location = await resolveWeatherLocation(station, cityFallback);
    if (!location) return null;

    const metrics = await fetchHourlyWeather(location.lat, location.lon, date);
    return {
        date,
        label: location.label,
        ...metrics
    };
}

async function safeGetStationWeather(station, dateStr) {
    try {
        return await getStationWeather(station, dateStr);
    } catch (err) {
        console.warn(`Open-Meteo fetch failed for ${dateStr}:`, err.message);
        return null;
    }
}

async function getLagFeatures(station, baseDateStr) {
    if (!station || !baseDateStr) {
        return {
            temp_lag_1: null, temp_lag_3: null, temp_lag_7: null,
            temp_max_lag_1: null, temp_max_lag_3: null, temp_max_lag_7: null,
            rain_lag_1: null, rain_lag_3: null, rain_lag_7: null
        };
    }

    const [lag1, lag3, lag7] = await Promise.all([
        safeGetStationWeather(station, isoDateOffset(baseDateStr, 1)),
        safeGetStationWeather(station, isoDateOffset(baseDateStr, 3)),
        safeGetStationWeather(station, isoDateOffset(baseDateStr, 7))
    ]);

    return {
        temp_lag_1: lag1 ? parseOptionalNumber(lag1.avg) : null,
        temp_lag_3: lag3 ? parseOptionalNumber(lag3.avg) : null,
        temp_lag_7: lag7 ? parseOptionalNumber(lag7.avg) : null,

        temp_max_lag_1: lag1 ? parseOptionalNumber(lag1.max) : null,
        temp_max_lag_3: lag3 ? parseOptionalNumber(lag3.max) : null,
        temp_max_lag_7: lag7 ? parseOptionalNumber(lag7.max) : null,

        rain_lag_1: lag1 ? parseOptionalNumber(lag1.rain) : null,
        rain_lag_3: lag3 ? parseOptionalNumber(lag3.rain) : null,
        rain_lag_7: lag7 ? parseOptionalNumber(lag7.rain) : null
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
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

    const today = localTodayIso();
    dateInput.value = today;

    const stateNames = Object.keys(data.kpi_data).sort();
    stateSelect.innerHTML = ['<option disabled selected value="">Select state</option>',
        ...stateNames.map((s) => `<option value="${s}">${s}</option>`)].join('');

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
        fetchWeather({ silent: true });
    });

    dateInput.addEventListener('change', () => {
        updateResolvedBadges();
        refreshClimatologyDefaults();
        if (stationSelect.value) fetchWeather({ silent: true });
    });

    updateResolvedBadges();

    let weatherDebounceTimer = null;

    async function fetchWeather({ silent = false } = {}) {
        const station = stationSelect.value;
        const date = dateInput.value;
        const city = cityInput.value;
        if (!station && !city.trim()) {
            if (!silent) showToast('Select a station or enter a city first.', 'warning');
            return;
        }

        fetchWeatherBtn.disabled = true;
        if (!silent) weatherFetchStatus.textContent = 'Fetching weather from Open-Meteo…';

        try {
            const weather = await getStationWeather(station, date, city);
            if (!weather) throw new Error('No location available for weather lookup');

            rainfallInput.value = weather.rain.toFixed(1);
            windSpeedInput.value = weather.wind_speed.toFixed(1);
            pressureInput.value = weather.pressure.toFixed(1);
            markFieldDirty('rainfall', 'open-meteo');
            markFieldDirty('wind_speed', 'open-meteo');
            markFieldDirty('air_pressure', 'open-meteo');

            const stamp = new Date().toLocaleTimeString();
            weatherFetchStatus.textContent =
                `Open-Meteo for ${weather.label} on ${date}: ${weather.avg.toFixed(1)}°C avg · ` +
                `pressure ${weather.pressure.toFixed(1)} hPa · wind ${weather.wind_speed.toFixed(1)} m/s · ` +
                `rain ${weather.rain.toFixed(1)} mm (fetched ${stamp})`;

            if (!silent) showToast('Weather inputs updated from Open-Meteo.', 'success');
        } catch (err) {
            console.error('Open-Meteo fetch failed:', err);
            if (!silent) showToast(`Could not fetch weather: ${err.message}`, 'error');
            weatherFetchStatus.textContent =
                `Could not fetch Open-Meteo data — ${err.message}. Using seasonal values instead.`;
        } finally {
            fetchWeatherBtn.disabled = false;
        }
    }

    fetchWeatherBtn.addEventListener('click', () => fetchWeather());

    cityInput.addEventListener('input', () => {
        clearTimeout(weatherDebounceTimer);
        weatherDebounceTimer = setTimeout(() => fetchWeather({ silent: true }), 900);
    });

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
            margin: { t: 20, b: 50, l: 45, r: 15 },
            yaxis: { title: 'Temperature (°C)' },
            legend: { orientation: 'h', y: -0.2 }
        };

        Plotly.react('comparisonChart', traces, themeLayout(layout), plotlyConfig);
    }

    async function predictViaApi(inputs) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

        try {
            const res = await fetch(`${PREDICTION_API_BASE_URL}/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    state: resolveStateCode(stateSelect.value),
                    district: districtSelect.value,
                    station_name: stationSelect.value,
                    date: dateInput.value,
                    rainfall: inputs.rainfall,
                    wind_speed: inputs.wind_speed,
                    air_pressure: inputs.air_pressure,
                    temp_lag_1: inputs.temp_lag_1,
                    temp_lag_3: inputs.temp_lag_3,
                    temp_lag_7: inputs.temp_lag_7,
                    temp_max_lag_1: inputs.temp_max_lag_1,
                    temp_max_lag_3: inputs.temp_max_lag_3,
                    temp_max_lag_7: inputs.temp_max_lag_7,
                    rain_lag_1: inputs.rain_lag_1,
                    rain_lag_3: inputs.rain_lag_3,
                    rain_lag_7: inputs.rain_lag_7
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
        if (!resolved) {
            showToast('Select a state, district and station first.', 'warning');
            return;
        }

        predictBtn.disabled = true;
        predictBtn.textContent = 'Fetching historical data…';

        const lagFeatures = await getLagFeatures(stationSelect.value, dateInput.value);

        const inputs = {
            rainfall: Number.isFinite(parseFloat(rainfallInput.value)) ? parseFloat(rainfallInput.value) : 0,
            wind_speed: Number.isFinite(parseFloat(windSpeedInput.value)) ? parseFloat(windSpeedInput.value) : 0,
            air_pressure: Number.isFinite(parseFloat(pressureInput.value)) ? parseFloat(pressureInput.value) : 0,
            ...lagFeatures
        };

        const climatology = resolved.data;

        predictBtn.textContent = 'Predicting…';
        const wakingUpTimer = setTimeout(() => { predictBtn.textContent = 'Waking up model…'; }, 4000);

        let predicted;
        try {
            predicted = await predictViaApi(inputs);
        } catch (err) {
            resultsSection.classList.add('hidden');
            predictionSourceNote.textContent = '';
            const message = err.name === 'AbortError'
                ? 'Prediction timed out. The model API may be waking up — try again in a moment.'
                : `Prediction failed: ${err.message}`;
            showToast(message, 'error');
            return;
        } finally {
            clearTimeout(wakingUpTimer);
            predictBtn.disabled = false;
            predictBtn.textContent = 'Predict temperature';
        }

        predictionSourceNote.textContent = 'Predicted using our trained machine learning model.';
        showToast('Prediction ready.', 'success');

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