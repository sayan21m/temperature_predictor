async function loadData() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
    try {
        const response = await fetch('../data_analysis/data.json');
        const data = await response.json();
        return data;
    } finally {
        if (overlay) overlay.style.display = 'none';
    }
}

// common configuration for all plots
var config = {
    scrollZoom: true,
    modeBarButtonsToRemove: ['zoom2d', 'select2d', 'lasso2d'],
    displaylogo: false
};

// defining the elements
const datasetColumn = document.getElementById('datasetBtn');
const datasetRowCount = document.getElementById('datasetRowCount');
const stationCount = document.getElementById('stationCount');
const targetColumn = document.getElementById('targetBtn');
const targetKPI = document.getElementById('targetMetric');
const missingValuesKPI = document.getElementById('missingValueCount');
const stateFilter = document.getElementById('state-filter');
const districtFilter = document.getElementById('district-filter');
const stationFilter = document.getElementById('station-filter');
const seasonFilter = document.getElementById('season-filter');
const totalRainfallKPI = document.getElementById('totalRainfallCount');
const avgTempKPI = document.getElementById('avgTemperatureCount');
const dataStat = document.getElementById('dataStatChart');
const dataStatTable = document.getElementById('dataStatTable');
const datasetTable = document.getElementById('dataPreviewTable');

let data;
let mapListenerAttached = false;

// declaring sorting flags
let currentSort = {
    column: null,
    asc: true
};

// ploting the time series graphs
function time_series_plot(df, id, y_title) {
    var data = {
        x: df[0].map(d => new Date(d)),
        y: df[1],
        type: 'scatter',
        mode: 'lines+markers'
    };

    var layout = {
        dragmode: "pan",
        title: 'Time Series Trend',
        xaxis: {title: 'Date', type: 'date'},
        yaxis: {title: y_title}
    };

    Plotly.react(id, [data], layout, config);
}

// ploting the location analysis graphs
function location_analysis_plot(x, y, id, x_title, y_title) {
    // const entries = Object.entries(df)
    // .sort((a, b) => b[1] - a[1]);

    const trace = {
        x: x,
        y: y,
        type: 'bar'
    };

    var layout = {
        dragmode: "pan",
        xaxis: {title: x_title},
        yaxis: {title: y_title}
    };

    Plotly.react(id, [trace], layout, config);
}

// plotting the coordinates on the map 
function map_plot(df, id) {
    const lat = df.map(d => d.latitude);
    const lon = df.map(d => d.longitude);
    const temp = df.map(d => d.avg_temp);

    const text = df.map(d =>
        `Avg Temp: ${d.avg_temp.toFixed(2)} °C<br>
         Min Temp: ${d.min_temp.toFixed(2)} °C<br>
         Max Temp: ${d.max_temp.toFixed(2)} °C<br>
         Rainfall: ${d.rainfall.toFixed(2)} mm<br>
         Wind: ${d.wind_speed.toFixed(2)} m/s<br>
         Pressure: ${d.air_pressure.toFixed(2)} hPa`
    );

    const trace = {
        type: "scattermapbox",
        lat: lat,
        lon: lon,
        text: text,
        mode: "markers",
        marker: {
            size: 8,
            color: temp,
            colorscale: "Turbo",
            showscale: true,
            colorbar: { title: "Avg Temp (°C)" }
        }
    };

    const layout = {
        dragmode: "pan",
        mapbox: {
            style: "open-street-map",
            center: { lat: 22.5, lon: 80 },
            zoom: 4
        },
        margin: { r: 0, t: 0, b: 0, l: 0 }
    };

    Plotly.react(id, [trace], layout, config);
}

// plotting the histogram 
function hist_plot(df, text, id) {
    const counts = df.count;
    const bins = df.bins;

    const bin_centers = [];
    for (let i = 0; i < bins.length - 1; i++) {
        bin_centers.push((bins[i] + bins[i + 1]) / 2);
    }

    const trace = {
        x: bin_centers,
        y: counts,
        type: "bar",
        marker: {
            color: "rgba(255, 100, 102, 0.7)",
            line: {
                color: "rgba(255, 100, 102, 1)",
                width: 1
            }
        }
    };

    const layout = {
        dragmode: "pan",
        xaxis: { title: text },
        yaxis: { title: "Frequency" },
        margin: { t: 30 }
    };

    Plotly.react(id, [trace], layout, config);
}

// box plot for outliers
function box_plot(df, text, id) {
    var trace = {
        y: df,
        type: 'box',
        name: text,
        outliercolor: 'rgba(219, 64, 82, 0.6)',
        marker: {
            color: 'rgb(8,81,156)',
            line: {
                outliercolor: 'rgba(219, 64, 82, 1.0)',
                outlierwidth: 2
            }
        },
        boxpoints: 'suspectedoutliers'
    };

    const layout = {
        dragmode: "pan",
        margin: { t: 30 }
    };
      
    Plotly.react(id, [trace], layout, config);
}

// plotting the data point - scatter plot
function scatter_plot(x, y, text, x_label, y_label, id) {
    var trace = {
        x: x,
        y: y,
        mode: 'markers',
        type: 'scatter',
        text: text,
        marker: {
            size: 6,
            opacity: 0.6
        }
    }

    const layout = {
        dragmode: "pan",
        margin: { t: 30 },
        title: {
            text: `${y_label} vs ${x_label}`
          },
          xaxis: {
            title: {
              text: x_label
            }
          },
          yaxis: {
            title: {
              text: y_label
            }
          }
    };
      
    Plotly.react(id, [trace], layout, config);
}

async function update_scatter() {
    const x_col = datasetColumn.value || 'elevation';
    const y_col = targetColumn.value || 'avg_temp';

    const x = data.scatter_sample.map(i => i[x_col]);
    const y = data.scatter_sample.map(i => i[y_col]);

    // plot only numerical columns
    if (typeof x[0] !== "number" || typeof y[0] !== "number") {
        window.alert("Scatter only supports numerical columns");
        return;
    }

    const text = data.scatter_sample.map(i =>
        `${i.station_name}<br>
         ${x_col}: ${i[x_col]}<br>
         ${y_col}: ${i[y_col]}`
    )
    scatter_plot(x, y, text, x_col, y_col, "scatterRelationChart");
}

// filtered scatter plot based on the state selected in the dropdown
function update_scatter_state() {
    const x_col = datasetColumn.value || 'elevation';
    const y_col = targetColumn.value || 'avg_temp';
    const filter = stateFilter.value

    const filtered = data.scatter_sample_state.filter(i => i.state === filter);
    const x = filtered.map(i => i[x_col]);
    const y = filtered.map(i => i[y_col]);

    // plot only numerical columns
    if (typeof x[0] !== "number" || typeof y[0] !== "number") {
        console.warn("Scatter only supports numerical columns");
        return;
    }

    const text = filtered.map(i =>
        `${i.station_name}<br>
         ${x_col}: ${i[x_col]}<br>
         ${y_col}: ${i[y_col]}`
    )
    scatter_plot(x, y, text, x_col, y_col, "scatterRelationChart");
}

// filtered scatter plot based on the season selected in the dropdown
function update_scatter_season() {
    const x_col = datasetColumn.value || 'elevation';
    const y_col = targetColumn.value || 'avg_temp';
    const filter = seasonFilter.value
    const filterState = stateFilter.value || null;

    let filtered;
    if (filterState) filtered = data.scatter_sample.filter(i => i.season === filter && i.state === filterState);
    else filtered = data.scatter_sample.filter(i => i.season === filter);
    
    const x = filtered.map(i => i[x_col]);
    const y = filtered.map(i => i[y_col]);
    const text = filtered.map(i =>
        `${i.station_name}<br>
            ${x_col}: ${i[x_col]}<br>
            ${y_col}: ${i[y_col]}`
    )

    // plot only numerical columns
    if (typeof x[0] !== "number" || typeof y[0] !== "number") {
        window.alert("Scatter only supports numerical columns");
        return;
    }

    scatter_plot(x, y, text, x_col, y_col, "scatterRelationChart");
}

// plotting the correlation heatmap
async function corr_heatmap(df, id) {
    const trace = {
        z: df.values,
        x: df.columns,
        y: df.columns,
        type: 'heatmap',
        colorscale: 'RdBu',
        zmin: -1,
        zmax: 1,
        text: df.values,
        texttemplate: "%{text:.2f}",
        textfont: {
            color: "black",
            size: 10
        }
    };

    const layout = {
        title: "Correlation Heatmap",
        dragmode: "pan"
    };

    Plotly.react(id, [trace], layout, config);
}

// plotting target correlation with the column selected in the target dropdown
function target_corr_plot(feature, values, id, target) {
    const trace = {
        x: feature,
        y: values,
        type: 'bar',
        marker: {
            color: values.map(v => v > 0 ? '#22c55e' : '#ef4444') // green/red
        }
    };

    const layout = {
        title: `Correlation with ${target}`,
        xaxis: { title: "Features" },
        yaxis: { title: "Correlation", range: [-1, 1] },
        dragmode: "pan"
    };

    Plotly.react(id, [trace], layout, config);
}

// plotting the monthly trend of the selected target in the target dropdown
function monthly_trend_plot(xValue, yValue, id) {
    let trace = {
        x: xValue,
        y: yValue,
        type: 'bar',
        text: yValue.map(i => String(i.toFixed(2))),
        textposition: 'auto',
        hoverinfo: 'none',
        marker: {
            color: 'rgb(158,202,225)',
            opacity: 0.6,
            line: {
                color: 'rgb(8,48,107)',
                width: 1.5
            }
        }
    };

    var layout = {
        title: {
          text: `Monthly Trend of ${targetColumn.value || 'avg_temp'}`
        },
        barmode: 'stack',
        barcornerradius: 15,
      };

    Plotly.react(id, [trace], layout, config);
}

function update_monthly_trend() {
    let xVal = data.monthly_trend.map(i => i.month);
    let targetCol = targetColumn.value || 'avg_temp';
    let yVal = data.monthly_trend.map(i => i[targetCol]);

    monthly_trend_plot(xVal, yVal, 'monthlyTrendChart');
}

// render the sorted dataset
function update_table(dataset) {
    let dataTableHead = ['<thead class="bg-slate-800 sticky top-0 z-10">',
        "<tr>",
        ...data.columns.map((k, l) => `<th onclick="sortTable(${l})" class="px-4 py-2 border-b border-slate-600 cursor-pointer hover:bg-slate-700 select-none">${k}</th>`),
        "</tr>",
        "</thead>"];

    let dataTableBody = ['<tbody class="overflow-hidden">']
    for (let row of dataset) {
        let rowVal = ['<tr class="bg-slate-900">']
        let rowEntry = Object.values(row).map(m => `<td class="px-4 py-2 border-b border-slate-700">${m}</td>`)
        rowVal.push(...rowEntry);
        rowVal.push("</tr>");
        dataTableBody.push(...rowVal);
    }
    dataTableHead.push(...dataTableBody);
    dataTableHead = dataTableHead.join('');
    datasetTable.innerHTML = dataTableHead;
}

async function main() {

    try {
        // loding the data
        data = await loadData();

        // setting KPI values
        if (datasetRowCount) {
            datasetRowCount.textContent = data.shape[0];
        }

        if (stationCount) {
            stationCount.textContent = data.station_count;
        }

        // adding option on target dropdown
        if (targetColumn) {
            let text = ['<option disabled selected value="">Select Target</option>', ...data.columns.map(i => `<option value="${i}">${i}</option>`)].join('');
            targetColumn.innerHTML = text;
        }

        // setting the data selected in target dropdown to Target KPI
        targetColumn.addEventListener('change', () => {
            targetKPI.textContent = targetColumn.value;

            // plotting the scatter plot of target vs feature selected in the dropdown
            try {update_scatter();}
            catch {window.alert("Scatterplot not available for the selected Target.");}

            // plotting the target correlation with other features
            try {
                const target_index = data.corr.columns.indexOf(targetColumn.value);
                const feature = data.corr.columns.filter(i => i !== targetColumn.value);
                const values = data.corr.values[target_index].filter(i => data.corr.values[target_index].indexOf(i) !== target_index);
                target_corr_plot(feature, values, targetCorrChart, targetColumn.value);
            } catch {window.alert("Correlation plot not available for the selected Target.");}

            try {
                update_monthly_trend();
            } catch {window.alert("Monthly trend plot not available for the selected Target.");}
        });

        // adding option on dataset dropdown
        if (datasetColumn) {
            let text = ['<option disabled selected value="">Select Feature</option>', ...data.columns.map(i => `<option value="${i}">${i}</option>`)].join('');
            datasetColumn.innerHTML = text;
        }

        // setting the missing value count to Missing KPI on dataset dropdown change
        datasetColumn.addEventListener('change', () => {
            missingValuesKPI.textContent = `${data.missing_values[datasetColumn.value].toFixed(2)} %`;

            // plotting the hstogram of the selected feature in dataset dropdown
            try {histogram_plots[datasetColumn.value]();}
            catch {window.alert("Histogram not available for the selected feature.");}

            // plotting the boxplot of the selected feature in dataset dropdown
            try {boxplots[datasetColumn.value]();}
            catch {window.alert("Boxplot not available for the selected feature.")}

            // plotting the scatter plot of target vs feature selected in the dropdown
            try {update_scatter();}
            catch {window.alert("Scatterplot not available for the selected Target.");}
        });

        // adding option on state, district, station and season dropdown
        if (stateFilter) {
            let text = ['<option disabled selected value="">State</option>', ...Object.keys(data.kpi_data).map(i => `<option value="${i}">${i}</option>`)].join('');
            stateFilter.innerHTML = text;
        }

        if (districtFilter && stateFilter) {
            let text = '<option disabled selected value="">District</option>'
            districtFilter.innerHTML = text;
        }

        if (stationFilter && districtFilter) {
            let text = '<option disabled selected value="">Station</option>'
            stationFilter.innerHTML = text;
        }

        if (seasonFilter && stationFilter) {
            let text = ['<option disabled selected value="">Season</option>', ...data.season_values.map(i => `<option value="${i}">${i}</option>`)].join('');
            seasonFilter.innerHTML = text;
        }

        // changing option on district, station and season dropdown and setting the values in avg temperature and total rainfall kpi according to the filter selected

        stateFilter.addEventListener('change', () => {
            if (districtFilter && stateFilter.value) {
                let text = ['<option disabled selected value="">District</option>', ...Object.keys(data.kpi_data[stateFilter.value].district).map(i => `<option value="${i}">${i}</option>`)].join('');
                districtFilter.innerHTML = text;
                totalRainfallKPI.textContent = `${data.kpi_data[stateFilter.value].rainfall.toFixed(2)} mm`;
                avgTempKPI.textContent = `${data.kpi_data[stateFilter.value].avg_temp.toFixed(2)} °C`;
                update_scatter_state();
            }
        });

        districtFilter.addEventListener('change', () => {
            if (stationFilter && districtFilter.value) {
                let text = ['<option disabled selected value="">Station</option>', ...Object.keys(data.kpi_data[stateFilter.value].district[districtFilter.value].station_name).map(i => `<option value="${i}">${i}</option>`)].join('');
                stationFilter.innerHTML = text;
                totalRainfallKPI.textContent = `${data.kpi_data[stateFilter.value].district[districtFilter.value].rainfall.toFixed(2)} mm`;
                avgTempKPI.textContent = `${data.kpi_data[stateFilter.value].district[districtFilter.value].avg_temp.toFixed(2)} °C`;
            }
        });

        stationFilter.addEventListener('change', () => {
            if (seasonFilter && stationFilter.value) {
                let text = ['<option disabled selected value="">Season</option>', ...Object.keys(data.kpi_data[stateFilter.value].district[districtFilter.value].station_name[stationFilter.value].season).map(i => `<option value="${i}">${i}</option>`)].join('');
                seasonFilter.innerHTML = text;
                totalRainfallKPI.textContent = `${data.kpi_data[stateFilter.value].district[districtFilter.value].station_name[stationFilter.value].rainfall.toFixed(2)} mm`;
                avgTempKPI.textContent = `${data.kpi_data[stateFilter.value].district[districtFilter.value].station_name[stationFilter.value].avg_temp.toFixed(2)} °C`;
            }
        });

        seasonFilter.addEventListener('change', () => {
            if (seasonFilter.value) {
                if (stateFilter.value && districtFilter.value && stationFilter.value) {
                    totalRainfallKPI.textContent = `${data.kpi_data[stateFilter.value].district[districtFilter.value].station_name[stationFilter.value].season[seasonFilter.value].rainfall.toFixed(2)} mm`;
                    avgTempKPI.textContent = `${data.kpi_data[stateFilter.value].district[districtFilter.value].station_name[stationFilter.value].season[seasonFilter.value].avg_temp.toFixed(2)} °C`;
                }
                update_scatter_season();
            } else {
                update_scatter();
            }
        });

        // plotting time series trend
        let time_series_plot_idx = 0;
        const time_series_plots = [
            () => time_series_plot(data.avg_temp_time, 'timeSeriesTrendChart', 'Average Temperature (°C)'),
            () => time_series_plot(data.min_temp_time, 'timeSeriesTrendChart', 'Minimum Temperature (°C)'),
            () => time_series_plot(data.max_temp_time, 'timeSeriesTrendChart', 'Maximum Temperature (°C)'),
            () => time_series_plot(data.wind_speed_time, 'timeSeriesTrendChart', 'Wind Speed (m/s)'),
            () => time_series_plot(data.air_pressure_time, 'timeSeriesTrendChart', 'Air Pressure (hPa)'),
            () => time_series_plot(data.rainfall_time, 'timeSeriesTrendChart', 'Total Rainfall (mm)'),
        ];

        time_series_plots[time_series_plot_idx]();

        const prevBtn = document.getElementById('prevTimeSeriesBtn');
        prevBtn.addEventListener('click', () => {
            time_series_plot_idx = (time_series_plot_idx - 1 + time_series_plots.length) % time_series_plots.length;
            time_series_plots[time_series_plot_idx]();
        });
        
        const nextBtn = document.getElementById('nextTimeSeriesBtn');
        nextBtn.addEventListener('click', () => {
            time_series_plot_idx = (time_series_plot_idx + 1) % time_series_plots.length;
            time_series_plots[time_series_plot_idx]();
        });

        // plotting location analysis chart
        let location_analysis_plot_idx = 0;
        // fetching the locationwise data
        let stateKey = Object.keys(data.kpi_data);
        let districtKey = [];
        let stationKey = [];

        let avg_temp_state_location = [];
        let min_temp_state_location = [];
        let max_temp_state_location = [];
        let wind_speed_state_location = [];
        let pressure_state_location = [];
        let rainfall_state_location = [];

        let avg_temp_district_location = [];
        let min_temp_district_location = [];
        let max_temp_district_location = [];
        let wind_speed_district_location = [];
        let pressure_district_location = [];
        let rainfall_district_location = [];

        let avg_temp_station_location = [];
        let min_temp_station_location = [];
        let max_temp_station_location = [];
        let wind_speed_station_location = [];
        let pressure_station_location = [];
        let rainfall_station_location = [];

        Object.entries(data.kpi_data).forEach(([state, stateData]) => {
            avg_temp_state_location.push(stateData.avg_temp);
            min_temp_state_location.push(stateData.min_temp);
            max_temp_state_location.push(stateData.max_temp);
            wind_speed_state_location.push(stateData.wind_speed);
            pressure_state_location.push(stateData.air_pressure);
            rainfall_state_location.push(stateData.rainfall);

            Object.entries(stateData.district).forEach(([district, districtData]) => {
                districtKey.push(district);
                avg_temp_district_location.push(districtData.avg_temp);
                min_temp_district_location.push(districtData.min_temp);
                max_temp_district_location.push(districtData.max_temp);
                wind_speed_district_location.push(districtData.wind_speed);
                pressure_district_location.push(districtData.air_pressure);
                rainfall_district_location.push(districtData.rainfall);

                Object.entries(districtData.station_name).forEach(([station, stationData]) => {
                    stationKey.push(station);
                    avg_temp_station_location.push(stationData.avg_temp);
                    min_temp_station_location.push(stationData.min_temp);
                    max_temp_station_location.push(stationData.max_temp);
                    wind_speed_station_location.push(stationData.wind_speed);
                    pressure_station_location.push(stationData.air_pressure);
                    rainfall_station_location.push(stationData.rainfall);
                });
            });
        });
        
        const location_analysis_plots = [
            // avg_temp
            () => location_analysis_plot(stateKey, avg_temp_state_location, 'locationAnalysisChart', 'State', 'Average Temperature (°C)'),
            () => location_analysis_plot(districtKey, avg_temp_district_location, 'locationAnalysisChart', 'District', 'Average Temperature (°C)'),
            () => location_analysis_plot(stationKey, avg_temp_station_location, 'locationAnalysisChart', 'Station', 'Average Temperature (°C)'),

            // min_temp
            () => location_analysis_plot(stateKey, min_temp_state_location, 'locationAnalysisChart', 'State', 'Minimum Temperature (°C)'),
            () => location_analysis_plot(districtKey, min_temp_district_location, 'locationAnalysisChart', 'District', 'Minimum Temperature (°C)'),
            () => location_analysis_plot(stationKey, min_temp_station_location, 'locationAnalysisChart', 'Station', 'Minimum Temperature (°C)'),

            // max_temp
            () => location_analysis_plot(stateKey, max_temp_state_location, 'locationAnalysisChart', 'State', 'Maximum Temperature (°C)'),
            () => location_analysis_plot(districtKey, max_temp_district_location, 'locationAnalysisChart', 'District', 'Maximum Temperature (°C)'),
            () => location_analysis_plot(stationKey, max_temp_station_location, 'locationAnalysisChart', 'Station', 'Maximum Temperature (°C)'),

            // wind_speed
            () => location_analysis_plot(stateKey, wind_speed_state_location, 'locationAnalysisChart', 'State', 'Wind Speed (m/s)'),
            () => location_analysis_plot(districtKey, wind_speed_district_location, 'locationAnalysisChart', 'District', 'Wind Speed (m/s)'),
            () => location_analysis_plot(stationKey, wind_speed_station_location, 'locationAnalysisChart', 'Station', 'Wind Speed (m/s)'),

            // air_pressure
            () => location_analysis_plot(stateKey, pressure_state_location, 'locationAnalysisChart', 'State', 'Air Pressure (hPa)'),
            () => location_analysis_plot(districtKey, pressure_district_location, 'locationAnalysisChart', 'District', 'Air Pressure (hPa)'),
            () => location_analysis_plot(stationKey, pressure_station_location, 'locationAnalysisChart', 'Station', 'Air Pressure (hPa)'),

            // rainfall
            () => location_analysis_plot(stateKey, rainfall_state_location, 'locationAnalysisChart', 'State', 'Avg Rainfall (mm)'),
            () => location_analysis_plot(districtKey, rainfall_district_location, 'locationAnalysisChart', 'District', 'Avg Rainfall (mm)'),
            () => location_analysis_plot(stationKey, rainfall_station_location, 'locationAnalysisChart', 'Station', 'Avg Rainfall (mm)'),

            // geo map
            () => map_plot(data.avg_temp_lat_long, 'locationAnalysisChart')
        ];

        location_analysis_plots[location_analysis_plot_idx]();

        const prevLocationBtn = document.getElementById('prevLocationBtn');
        prevLocationBtn.addEventListener('click', () => {
            location_analysis_plot_idx = (location_analysis_plot_idx - 1 + location_analysis_plots.length) % location_analysis_plots.length;
            location_analysis_plots[location_analysis_plot_idx]();
        });
        
        const nextLocationBtn = document.getElementById('nextLocationBtn');
        nextLocationBtn.addEventListener('click', () => {
            location_analysis_plot_idx = (location_analysis_plot_idx + 1) % location_analysis_plots.length;
            location_analysis_plots[location_analysis_plot_idx]();
        });

        // plotting histogram of the selected feature in dataset dropdown and executed in the dropdown change event
        const histogram_plots = {
            'avg_temp' : () => hist_plot(data.avg_temp_hist, 'Average Temperature (°C)', 'histogramChart'),
            'min_temp' : () => hist_plot(data.min_temp_hist, 'Minimum Temperature (°C)', 'histogramChart'),
            'max_temp' : () => hist_plot(data.max_temp_hist, 'Maximum Temperature (°C)', 'histogramChart'),
            'rainfall' : () => hist_plot(data.rainfall_hist, 'Total Rainfall (mm)', 'histogramChart'),
            'wind_speed' : () => hist_plot(data.wind_speed_hist, 'Wind Speed (m/s)', 'histogramChart'),
            'air_pressure' : () => hist_plot(data.air_pressure_hist, 'Air Pressure (hPa)', 'histogramChart'),
        };
        histogram_plots['avg_temp']();

        // plotting boxplot of the selected feature in dataset dropdown and executed in the dropdown change event
        const boxplots = {
            'avg_temp': () => box_plot(data.boxplot['avg_temp'], 'Avgerage Temperature (°C)', 'boxPlotChart'),
            'min_temp': () => box_plot(data.boxplot['min_temp'], 'Minimum Temperature (°C)', 'boxPlotChart'),
            'max_temp': () => box_plot(data.boxplot['max_temp'], 'Maximum Temperature (°C)', 'boxPlotChart'),
            'rainfall': () => box_plot(data.boxplot['rainfall'], 'Total Rainfall (mm)', 'boxPlotChart'),
            'wind_speed': () => box_plot(data.boxplot['wind_speed'], 'Wind Speed (m/s)', 'boxPlotChart'),
            'air_pressure': () => box_plot(data.boxplot['air_pressure'], 'Air Pressure (hPa)', 'boxPlotChart'),
        };
        boxplots['avg_temp']();

        // plotting scatterplot of the selected feature vs selected target from the dropdown and executed in the dropdown change event
        update_scatter();

        // plotting the correlation heatmap
        corr_heatmap(data.corr, 'heatmapChart');

        // plotting the target correlation with other features
        const target_index = data.corr.columns.indexOf('avg_temp');
        const feature = data.corr.columns.filter(i => i !== 'avg_temp');
        const values = data.corr.values[target_index].filter(i => data.corr.values[target_index].indexOf(i) !== target_index);
        target_corr_plot(feature, values, targetCorrChart, 'avg_temp')

        // plotting the monthly trend and change according to the target dropdown change
        update_monthly_trend();

        // displaying the data stats
        let statHead = ['<thead class="bg-slate-800 sticky top-0 z-10">', "<tr>", ...Object.keys(data.stats[0]).map(k => `<th class="px-4 py-2 border-b border-slate-600">${k}</th>`), "</tr>", "</thead>"];

        let statBody = ["<tbody>"]
        for (let row of data.stats) {
            let rowVal = ['<tr class="bg-slate-900">']
            let rowEntry = Object.values(row).map(m => `<td class="px-4 py-2 border-b border-slate-700">${m}</td>`)
            rowVal.push(...rowEntry);
            statBody.push(...rowVal);
        }

        statHead.push(...statBody);
        statHead = statHead.join('');
        dataStatTable.innerHTML = statHead;

        // display the data table
        update_table(data.scatter_sample.slice(0, 50));

        window.sortTable = function(colIdx) {
            let col = data.columns[colIdx];

            if (currentSort.column === col) {
                currentSort.asc = !(currentSort.asc);
            } else {
                currentSort.column = col;
                currentSort.asc = true;
            }

            let sortedData = data.scatter_sample.slice(0, 50).sort((a, b) => {
                let valA = a[col];
                let valB = b[col];

                // sorting the numerical values
                const numA = parseFloat(valA);
                const numB = parseFloat(valB);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return currentSort.asc ? numA - numB : numB - numA;
                }

                const dateA = new Date(valA).getTime();
                const dateB = new Date(valB).getTime();
                if (!isNaN(dateA) && !isNaN(dateB)) {
                    return currentSort.asc ? dateA - dateB : dateB - dateA;
                }

                return currentSort.asc
                ? String(valA).localeCompare(String(valB))
                : String(valB).localeCompare(String(valA));
            });

            update_table(sortedData);
        }
    } catch (err) {
        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#555;">
                <h2>⚠️ Failed to load dashboard data</h2>
                <p>Make sure <code>data.json</code> exists at <code>../data_analysis/data.json</code></p>
                <pre style="color:red;">${err.message}</pre>
            </div>`;
    }
    
}

main();