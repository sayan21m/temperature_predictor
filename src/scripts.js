async function loadData() {
    const response = await fetch('../data_analysis/data.json');
    const data = await response.json();
    return data;
}

async function main() {
    const data = await loadData();

    // setting KPI values
    const datasetRowCount = document.getElementById('datasetRowCount');
    if (datasetRowCount) {
        datasetRowCount.textContent = data.shape[0];
    }

    const stationCount = document.getElementById('stationCount');
    if (stationCount) {
        stationCount.textContent = Object.values(data.station)
        .flat()
        .length;
    }

    // adding option on target dropdown
    const targetColumn = document.getElementById('targetBtn');
    if (targetColumn) {
        let text = ""
        for (let i of data.columns) {
            text += `<option value="${i}">${i}</option>`;
        }
        targetColumn.innerHTML = text;
    }

    // setting the data selected in target dropdown to Target KPI
    const targetKPI = document.getElementById('targetMetric');
    targetKPI.textContent = targetColumn.value;
    targetColumn.addEventListener('change', () => {
        targetKPI.textContent = targetColumn.value;
    });

    // adding option on dataset dropdown
    const datasetColumn = document.getElementById('datasetBtn');
    if (datasetColumn) {
        let text = ""
        for (let i of data.columns) {
            text += `<option value="${i}">${i}</option>`;
        }
        datasetColumn.innerHTML = text;
    }

    // setting the missing value count to Missing KPI
    const missingValuesKPI = document.getElementById('missingValueCount');
    if (missingValuesKPI) {
        missingValuesKPI.textContent = `${data.missing_values[datasetColumn.value]} %`;
    }
    datasetColumn.addEventListener('change', () => {
        missingValuesKPI.textContent = `${data.missing_values[datasetColumn.value].toFixed(2)} %`;
    });

    // adding option on state, district, station and season dropdown
    const stateFilter = document.getElementById('state-filter');
    if (stateFilter) {
        let text = '<option disabled selected value="">State</option>'
        for (let i of data.state) {
            text += `<option value="${i}">${i}</option>`;
        }
        stateFilter.innerHTML = text;
    }

    const districtFilter = document.getElementById('district-filter');
    if (districtFilter && stateFilter) {
        let text = '<option disabled selected value="">District</option>'
        districtFilter.innerHTML = text;
    }

    const stationFilter = document.getElementById('station-filter');
    if (stationFilter && districtFilter) {
        let text = '<option disabled selected value="">Station</option>'
        stationFilter.innerHTML = text;
    }

    const seasonFilter = document.getElementById('season-filter');
    if (seasonFilter && stationFilter) {
        let text = '<option disabled selected value="">Season</option>'
        seasonFilter.innerHTML = text;
    }

    // changing option on district, station and season dropdown and setting the values in avg temperature and total rainfall kpi according to the filter selected
    const totalRainfallKPI = document.getElementById('totalRainfallCount');
    const avgTempKPI = document.getElementById('avgTemperatureCount');

    stateFilter.addEventListener('change', () => {
        if (districtFilter && stateFilter.value) {
            let text = '<option disabled selected value="">District</option>'
            for (let i of data.district[stateFilter.value]) {
                text += `<option value="${i}">${i}</option>`;
            }
            districtFilter.innerHTML = text;
            totalRainfallKPI.textContent = `${data.state_rainfall[stateFilter.value].toFixed(2)} mm`;
            avgTempKPI.textContent = `${data.state_avg_temp[stateFilter.value].toFixed(2)} °C`;
        }
    });

    districtFilter.addEventListener('change', () => {
        if (stationFilter && districtFilter.value) {
            let text = '<option disabled selected value="">Station</option>'
            for (let i of data.station[districtFilter.value]) {
                text += `<option value="${i}">${i}</option>`;
            }
            stationFilter.innerHTML = text;
            totalRainfallKPI.textContent = `${data.district_rainfall[stateFilter.value][districtFilter.value].toFixed(2)} mm`;
            avgTempKPI.textContent = `${data.district_avg_temp[stateFilter.value][districtFilter.value].toFixed(2)} °C`;
        }
    });

    stationFilter.addEventListener('change', () => {
        if (seasonFilter && stationFilter.value) {
            let text = '<option disabled selected value="">Season</option>'
            for (let i of data.season[stationFilter.value]) {
                text += `<option value="${i}">${i}</option>`;
            }
            seasonFilter.innerHTML = text;
            totalRainfallKPI.textContent = `${data.station_rainfall[stateFilter.value][districtFilter.value][stationFilter.value].toFixed(2)} mm`;
            avgTempKPI.textContent = `${data.station_avg_temp[stateFilter.value][districtFilter.value][stationFilter.value].toFixed(2)} °C`;
        }
    });

    seasonFilter.addEventListener('change', () => {
        if (easonFilter.value) {
            totalRainfallKPI.textContent = `${data.season_rainfall[stateFilter.value][districtFilter.value][stationFilter.value][seasonFilter.value].toFixed(2)} mm`;
            avgTempKPI.textContent = `${data.season_avg_temp[stateFilter.value][districtFilter.value][stationFilter.value][seasonFilter.value].toFixed(2)} °C`;
        }
    });

}

main();