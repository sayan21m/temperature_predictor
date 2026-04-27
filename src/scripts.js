async function loadData() {
    const response = await fetch('../data_analysis/data.json');
    const data = await response.json();
    return data;
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

let data;

// ploting the time series graphs
async function time_series_plot(df, id, y_title) {
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
async function location_analysis_plot(df, id, x_title, y_title) {
    const entries = Object.entries(df)
    .sort((a, b) => b[1] - a[1]);

    const trace = {
        x: entries.map(e => e[0]),
        y: entries.map(e => e[1]),
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
async function map_plot(df, id) {
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

    Plotly.react(id, [trace], layout, config).then(gd => {
        gd.on('plotly_relayout', ev => {
            if (ev['mapbox.center']) {
                Plotly.relayout(id, {
                    'mapbox.center.lat': 22.5
                });
            }
        });
    });
}

// plotting the histogram 
async function hist_plot(df, text, id) {
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
async function box_plot(df, text, id) {
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
async function scatter_plot(x, y, text, x_label, y_label, id) {
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
        console.warn("Scatter only supports numerical columns");
        return;
    }

    const text = data.scatter_sample.map(i =>
        `${i.station_name}<br>
         ${x_col}: ${i[x_col]}<br>
         ${y_col}: ${i[y_col]}`
    )
    scatter_plot(x, y, text, x_col, y_col, "scatterRelationChart");
}

async function main() {

    // loding the data
    data = await loadData();

    // setting KPI values
    if (datasetRowCount) {
        datasetRowCount.textContent = data.shape[0];
    }

    if (stationCount) {
        stationCount.textContent = Object.values(data.station)
        .flat()
        .length;
    }

    // adding option on target dropdown
    if (targetColumn) {
        let text = '<option disabled selected value="">Select Target</option>'
        for (let i of data.columns) {
            text += `<option value="${i}">${i}</option>`;
        }
        targetColumn.innerHTML = text;
    }

    // setting the data selected in target dropdown to Target KPI
    targetColumn.addEventListener('change', () => {
        targetKPI.textContent = targetColumn.value;

        // plotting the scatter plot of target vs feature selected in the dropdown
        try {update_scatter();}
        catch {window.alert("Scatterplot not available for the selected Target.");}
    });

    // adding option on dataset dropdown
    if (datasetColumn) {
        let text = '<option disabled selected value="">Select Feature</option>'
        for (let i of data.columns) {
            text += `<option value="${i}">${i}</option>`;
        }
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
        let text = '<option disabled selected value="">State</option>'
        for (let i of data.state) {
            text += `<option value="${i}">${i}</option>`;
        }
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
        let text = '<option disabled selected value="">Season</option>'
        seasonFilter.innerHTML = text;
    }

    // changing option on district, station and season dropdown and setting the values in avg temperature and total rainfall kpi according to the filter selected

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
        if (seasonFilter.value) {
            totalRainfallKPI.textContent = `${data.season_rainfall[stateFilter.value][districtFilter.value][stationFilter.value][seasonFilter.value].toFixed(2)} mm`;
            avgTempKPI.textContent = `${data.season_avg_temp[stateFilter.value][districtFilter.value][stationFilter.value][seasonFilter.value].toFixed(2)} °C`;
        }
    });

    // plotting time series trend
    let time_searies_plot_idx = 0;
    const time_series_plots = [
        () => time_series_plot(data.avg_temp_time, 'timeSeriesTrendChart', 'Average Temperature (°C)'),
        () => time_series_plot(data.min_temp_time, 'timeSeriesTrendChart', 'Minimum Temperature (°C)'),
        () => time_series_plot(data.max_temp_time, 'timeSeriesTrendChart', 'Maximum Temperature (°C)'),
        () => time_series_plot(data.wind_speed_time, 'timeSeriesTrendChart', 'Wind Speed (m/s)'),
        () => time_series_plot(data.air_pressure_time, 'timeSeriesTrendChart', 'Air Pressure (hPa)'),
        () => time_series_plot(data.rainfall_time, 'timeSeriesTrendChart', 'Total Rainfall (mm)'),
    ];

    time_series_plots[time_searies_plot_idx]();

    const prevBtn = document.getElementById('prevTimeSeriesBtn');
    prevBtn.addEventListener('click', async () => {
        time_searies_plot_idx = (time_searies_plot_idx - 1 + time_series_plots.length) % time_series_plots.length;
        await time_series_plots[time_searies_plot_idx]();
    });
    
    const nextBtn = document.getElementById('nextTimeSeriesBtn');
    nextBtn.addEventListener('click', async () => {
        time_searies_plot_idx = (time_searies_plot_idx + 1) % time_series_plots.length;
        await time_series_plots[time_searies_plot_idx]();
    });

    // plotting location analysis chart
    let location_analysis_plot_idx = 0;
    const location_analysis_plots = [
        () => location_analysis_plot(data.state_avg_temp, 'locationAnalysisChart', 'State', 'Average Temperature (°C)'),
        () => location_analysis_plot(data.avg_temp_district, 'locationAnalysisChart', 'District', 'Average Temperature (°C)'),
        () => location_analysis_plot(data.avg_temp_station, 'locationAnalysisChart', 'Station', 'Average Temperature (°C)'),
        () => location_analysis_plot(data.state_min_temp, 'locationAnalysisChart', 'State', 'Minimum Temperature (°C)'),
        () => location_analysis_plot(data.min_temp_district, 'locationAnalysisChart', 'District', 'Minimum Temperature (°C)'),
        () => location_analysis_plot(data.min_temp_station, 'locationAnalysisChart', 'Station', 'Minimum Temperature (°C)'),
        () => location_analysis_plot(data.state_max_temp, 'locationAnalysisChart', 'State', 'Maximum Temperature (°C)'),
        () => location_analysis_plot(data.max_temp_district, 'locationAnalysisChart', 'District', 'Maximum Temperature (°C)'),
        () => location_analysis_plot(data.max_temp_station, 'locationAnalysisChart', 'Station', 'Maximum Temperature (°C)'),
        () => location_analysis_plot(data.state_wind_speed, 'locationAnalysisChart', 'State', 'Wind Speed (m/s)'),
        () => location_analysis_plot(data.wind_speed_district, 'locationAnalysisChart', 'District', 'Wind Speed (m/s)'),
        () => location_analysis_plot(data.wind_speed_station, 'locationAnalysisChart', 'Station', 'Wind Speed (m/s)'),
        () => location_analysis_plot(data.state_air_pressure, 'locationAnalysisChart', 'State', 'Air Pressure (hPa)'),
        () => location_analysis_plot(data.air_pressure_district, 'locationAnalysisChart', 'District', 'Air Pressure (hPa)'),
        () => location_analysis_plot(data.air_pressure_station, 'locationAnalysisChart', 'Station', 'Air Pressure (hPa)'),
        () => location_analysis_plot(data.state_rainfall, 'locationAnalysisChart', 'State', 'Avg Rainfall (mm)'),
        () => location_analysis_plot(data.rainfall_district, 'locationAnalysisChart', 'District', 'Avg Rainfall (mm)'),
        () => location_analysis_plot(data.rainfall_station, 'locationAnalysisChart', 'Station', 'Avg Rainfall (mm)'),
        () => map_plot(data.avg_temp_lat_long, 'locationAnalysisChart')
    ];

    location_analysis_plots[location_analysis_plot_idx]();

    const prevLocationBtn = document.getElementById('prevLocationBtn');
    prevLocationBtn.addEventListener('click', async () => {
        location_analysis_plot_idx = (location_analysis_plot_idx - 1 + location_analysis_plots.length) % location_analysis_plots.length;
        await location_analysis_plots[location_analysis_plot_idx]();
    });
    
    const nextLocationBtn = document.getElementById('nextLocationBtn');
    nextLocationBtn.addEventListener('click', async () => {
        location_analysis_plot_idx = (location_analysis_plot_idx + 1) % location_analysis_plots.length;
        await location_analysis_plots[location_analysis_plot_idx]();
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
    const scatter_plots = [() => scatter_plot(data.scatter_sample.map(i => i.elevation), data.scatter_sample.map(i => i.avg_temp), data.scatter_sample.map(i => `${i.station_name}`), "elevation", "avg_temp", "scatterRelationChart")];
    scatter_plots[0]();

    
}

main();