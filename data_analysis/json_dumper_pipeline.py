import json
import pandas as pd
import numpy as np

df = pd.read_excel("../india_weather_rainfall_data.xlsx")

def outlier_stats(series):
    q1 = series.quantile(0.25)
    q3 = series.quantile(0.75)
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr

    return {
        "q1": float(q1),
        "q3": float(q3),
        "median": float(series.median()),
        "lower": float(lower),
        "upper": float(upper),
        "outliers": int(((series < lower) | (series > upper)).sum())
    }

class CompactEncoder(json.JSONEncoder):
    def iterencode(self, obj, **kw):
        if isinstance(obj, float):
            yield format(obj, '.4f')
            return
        yield from super().iterencode(obj, **kw)

try:
    missing_values = {}
    null_count = df.isnull().sum()
    for n, i in enumerate(null_count):
        missing_values[df.columns[n]] = 100 - (df.shape[0] - i)/df.shape[0]*100

    df = df.dropna(subset=['date_of_record'])
    df['date_of_record'] = pd.to_datetime(df['date_of_record'])
    df['avg_temp'] = df['avg_temp'].fillna(df.groupby(['month', 'station_name'])['avg_temp'].transform('mean'))
    df['avg_temp'] = df['avg_temp'].fillna(df['avg_temp'].median())
    df['max_temp'] = df['max_temp'].fillna(df.groupby(['month', 'station_name'])['max_temp'].transform('mean'))
    df['max_temp'] = df['max_temp'].fillna(df['max_temp'].median())
    df['min_temp'] = df['min_temp'].fillna(df.groupby(['month', 'station_name'])['min_temp'].transform('mean'))
    df['min_temp'] = df['min_temp'].fillna(df['min_temp'].median())
    df['wind_speed'] = df['wind_speed'].fillna(df.groupby(['month', 'station_name'])['wind_speed'].transform('mean'))
    df['wind_speed'] = df['wind_speed'].fillna(df['wind_speed'].median())
    df['air_pressure'] = df['air_pressure'].fillna(df.groupby(['month', 'station_name'])['air_pressure'].transform('mean'))
    df['air_pressure'] = df['air_pressure'].fillna(df['air_pressure'].median())
    df['rainfall'] = df['rainfall'].fillna(df.groupby(['month', 'station_name'])['rainfall'].transform('mean'))
    df['rainfall'] = df['rainfall'].fillna(df['rainfall'].median())

    df = df.drop_duplicates()

    temp_series = df.groupby('date_of_record')['avg_temp'].mean()
    min_temp_series = df.groupby('date_of_record')['min_temp'].mean()
    max_temp_series = df.groupby('date_of_record')['max_temp'].mean()
    wind_speed_series = df.groupby('date_of_record')['wind_speed'].mean()
    air_pressure_series = df.groupby('date_of_record')['air_pressure'].mean()
    rainfall_series = df.groupby('date_of_record')['rainfall'].mean()

    df_sample = df.sample(5000, random_state=42)
    df_state_sample = df.groupby('state', group_keys=False)\
        .apply(lambda x: x.sample(min(len(x), 500)))\
        .reset_index(drop=True)

    df_season_sample = df.groupby('season', group_keys=False).apply(lambda x: x.sample(min(len(x), 500))).reset_index(drop=True)

    corr = df.corr(numeric_only=True)
    target_corr = df.corr(numeric_only=True)['avg_temp'].drop('avg_temp').sort_values(ascending=False)

    monthly_trend = df.groupby('month').agg({
        'avg_temp': 'mean',
        'max_temp': 'mean',
        'min_temp': 'mean',
        'wind_speed': 'mean',
        'air_pressure': 'mean',
        'rainfall': 'mean',
    }).reset_index(drop=False)
    month_map = {
        'January': 1,
        'February': 2,
        'March': 3,
        'April': 4,
        'May': 5,
        'June': 6,
        'July': 7,
        'August': 8,
        'September': 9,
        'October': 10,
        'November': 11,
        'December': 12,
    }
    monthly_trend['weight'] = monthly_trend['month'].map(month_map)
    monthly_trend = monthly_trend.sort_values(by='weight')
    monthly_trend = monthly_trend.drop(columns=['weight'])

    stat = df.describe().reset_index().to_dict(orient='records')
    for idx, row in enumerate(stat):
        for k, v in row.items():
            if isinstance(v, pd.Timestamp):
                stat[idx][k] = str(v)
            if pd.isna(v):
                stat[idx][k] = None

    kpi_data = {}

    state_values = df.groupby(['state']).agg({
        'avg_temp' : 'mean',
        'min_temp' : 'mean',
        'max_temp' : 'mean',
        'wind_speed' : 'mean',
        'air_pressure' : 'mean',
        'rainfall' : 'mean',
    }).reset_index().to_dict(orient='records')

    for i in state_values:
        kpi_data[i['state']] = {
            'avg_temp': i['avg_temp'],
            'min_temp': i['min_temp'],
            'max_temp': i['max_temp'],
            'wind_speed': i['wind_speed'],
            'air_pressure': i['air_pressure'],
            'rainfall': i['rainfall'],
            'district': {}
        }

    district_values = df.groupby(['state', 'district']).agg({
        'avg_temp' : 'mean',
        'min_temp' : 'mean',
        'max_temp' : 'mean',
        'wind_speed' : 'mean',
        'air_pressure' : 'mean',
        'rainfall' : 'mean',
    }).reset_index().to_dict(orient='records')

    for i in district_values:
        kpi_data[i['state']]['district'][i['district']] = {
            'avg_temp': i['avg_temp'],
            'min_temp': i['min_temp'],
            'max_temp': i['max_temp'],
            'wind_speed': i['wind_speed'],
            'air_pressure': i['air_pressure'],
            'rainfall': i['rainfall'],
            'station_name': {}
        }

    station_values = df.groupby(['state', 'district', 'station_name']).agg({
        'avg_temp' : 'mean',
        'min_temp' : 'mean',
        'max_temp' : 'mean',
        'wind_speed' : 'mean',
        'air_pressure' : 'mean',
        'rainfall' : 'mean',
    }).reset_index().to_dict(orient='records')

    for i in station_values:
        kpi_data[i['state']]['district'][i['district']]['station_name'][i['station_name']] = {
            'avg_temp': i['avg_temp'],
            'min_temp': i['min_temp'],
            'max_temp': i['max_temp'],
            'wind_speed': i['wind_speed'],
            'air_pressure': i['air_pressure'],
            'rainfall': i['rainfall'],
            'season': {}
        }

    season_values = df.groupby(['state', 'district', 'station_name', 'season']).agg({
        'avg_temp' : 'mean',
        'min_temp' : 'mean',
        'max_temp' : 'mean',
        'wind_speed' : 'mean',
        'air_pressure' : 'mean',
        'rainfall' : 'mean',
    }).reset_index().to_dict(orient='records')

    for i in season_values:
        kpi_data[i['state']]['district'][i['district']]['station_name'][i['station_name']]['season'][i['season']] = {
            'avg_temp': i['avg_temp'],
            'min_temp': i['min_temp'],
            'max_temp': i['max_temp'],
            'wind_speed': i['wind_speed'],
            'air_pressure': i['air_pressure'],
            'rainfall': i['rainfall'],
        }

    skewness = df.skew(numeric_only=True).to_dict()
    kurt = df.kurtosis(numeric_only=True).to_dict()

    data = {
        # dataset details
        "shape":df.shape,
        "columns": df.columns.tolist(),

        # unique values
        "season_values": df['season'].unique().tolist(),
        "station_count": df['station_name'].nunique(),

        # missing value count
        "missing_values": missing_values,
        "null_count": null_count.to_dict(),

        "kpi_data": kpi_data,

        # time series trend analysis
        "avg_temp_time": [temp_series.index.astype(str).tolist(), temp_series.values.tolist()],
        "min_temp_time": [min_temp_series.index.astype(str).tolist(), min_temp_series.values.tolist()],
        "max_temp_time": [max_temp_series.index.astype(str).tolist(), max_temp_series.values.tolist()],
        "wind_speed_time": [wind_speed_series.index.astype(str).tolist(), wind_speed_series.values.tolist()],
        "air_pressure_time": [air_pressure_series.index.astype(str).tolist(), air_pressure_series.values.tolist()],
        "rainfall_time": [rainfall_series.index.astype(str).tolist(), rainfall_series.values.tolist()],

        # location analysis
        "avg_temp_lat_long" : df.groupby(['latitude','longitude']).agg({
            'avg_temp': 'mean',
            'min_temp': 'mean',
            'max_temp': 'mean',
            'wind_speed': 'mean',
            'air_pressure': 'mean',
            'rainfall': 'mean',
        }).reset_index().to_dict(orient='records'),
        "rainfall_lat_long": df.groupby(['latitude','longitude'])['rainfall'].mean().reset_index().to_dict(orient='records'),

        # distribution analysis
        "avg_temp_hist": {'count': np.histogram(df['avg_temp'], bins=1000)[0].tolist(), 'bins': np.histogram(df['avg_temp'], bins=1000)[1].tolist()},
        "min_temp_hist": {'count': np.histogram(df['min_temp'], bins=1000)[0].tolist(), 'bins': np.histogram(df['min_temp'], bins=1000)[1].tolist()},
        "max_temp_hist": {'count': np.histogram(df['max_temp'], bins=1000)[0].tolist(), 'bins': np.histogram(df['max_temp'], bins=1000)[1].tolist()},
        "wind_speed_hist": {'count': np.histogram(df['wind_speed'], bins=1000)[0].tolist(), 'bins': np.histogram(df['wind_speed'], bins=1000)[1].tolist()},
        "air_pressure_hist": {'count': np.histogram(df['air_pressure'], bins=1000)[0].tolist(), 'bins': np.histogram(df['air_pressure'], bins=1000)[1].tolist()},
        "rainfall_hist": {'count': np.histogram(df['rainfall'], bins=1000)[0].tolist(), 'bins': np.histogram(df['rainfall'], bins=1000)[1].tolist()},

        # outlier analysis
        "boxplot" : {
            "avg_temp": df_sample['avg_temp'].dropna().tolist(),
            "min_temp": df_sample['min_temp'].dropna().tolist(),
            "max_temp": df_sample['max_temp'].dropna().tolist(),
            "wind_speed": df_sample['wind_speed'].dropna().tolist(),
            "air_pressure": df_sample['air_pressure'].dropna().tolist(),
            "rainfall": df_sample['rainfall'].dropna().tolist(),
            "elevation": df_sample['elevation'].dropna().tolist(),
        },
        "outlier_stat": {
            "avg_temp": outlier_stats(df['avg_temp']),
            "min_temp": outlier_stats(df['min_temp']),
            "max_temp": outlier_stats(df['max_temp']),
            "wind_speed": outlier_stats(df['wind_speed']),
            "air_pressure": outlier_stats(df['air_pressure']),
            "rainfall": outlier_stats(df['rainfall'])
        },

        # scatter plot
        "scatter_sample": df_sample.to_dict(orient='records'),
        "scatter_sample_state": df_state_sample.to_dict(orient='records'),
        "scatter_sample_season": df_season_sample.to_dict(orient = 'records'),

        # correlation heatmap of numeric columns
        "corr": {
            'columns': corr.columns.tolist(),
            'values': corr.values.tolist()
        },

        # monthly trend
        "monthly_trend": monthly_trend.to_dict(orient='records'),

        # data stats
        'stats': stat,
        "skewness": skewness,
        "kurtosis": kurt,
    }

    with open('data.json', 'w') as f:
        json.dump(data, f, cls=CompactEncoder, indent=4, default=str)

    print("Data dumped successfully!")

except:
    print("Data dump failed")