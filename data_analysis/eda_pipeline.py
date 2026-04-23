import pandas as pd
import seaborn as sns
from matplotlib import pyplot as plt

df1 = pd.read_excel(r"../india_weather_rainfall_data.xlsx")
print(df1.head(10))

print(f"columns: {df1.columns}")
print("Dataset info:\n", df1.info())

numerical = df1.select_dtypes(include=['float64', 'int64']).columns
categorical = df1.select_dtypes(include=['object']).columns
time = df1.select_dtypes(include=['datetime64']).columns
print(f"Numerical columns: {numerical}, Categorical columns: {categorical}, Date-Time columns: {time}")

null_count = df1.isnull().sum()
for n, i in enumerate(null_count):
    print(f"{df1.columns[n]} : {i} ({100 - (df1.shape[0] - i)/df1.shape[0]*100:.2f}%)")

mask_jh = (
    (df1['state'] == 'JK') &
    (df1['latitude'].between(21, 25)) &
    (df1['longitude'].between(83, 88))
)

df1.loc[mask_jh, 'state'] = 'JH'

df1 = df1.dropna(subset=['date_of_record'])
df1['date_of_record'] = pd.to_datetime(df1['date_of_record'])
df1['max_temp'] = df1['max_temp'].fillna(df1.groupby(['month', 'station_name'])['max_temp'].transform('mean'))
df1['max_temp'] = df1['max_temp'].fillna(df1['max_temp'].median())
df1['min_temp'] = df1['min_temp'].fillna(df1.groupby(['month', 'station_name'])['min_temp'].transform('mean'))
df1['min_temp'] = df1['min_temp'].fillna(df1['min_temp'].median())
df1['wind_speed'] = df1['wind_speed'].fillna(df1.groupby(['month', 'station_name'])['wind_speed'].transform('mean'))
df1['wind_speed'] = df1['wind_speed'].fillna(df1['wind_speed'].median())
df1['air_pressure'] = df1['air_pressure'].fillna(df1.groupby(['month', 'station_name'])['air_pressure'].transform('mean'))
df1['air_pressure'] = df1['air_pressure'].fillna(df1['air_pressure'].median())
df1['rainfall'] = df1['rainfall'].fillna(df1.groupby(['month', 'station_name'])['rainfall'].transform('mean'))
df1['rainfall'] = df1['rainfall'].fillna(df1['rainfall'].median())

df1 = df1.drop_duplicates()

print(df1.describe())

df1 = df1.sort_values('date_of_record')

print("Univariate analysis:")
cols = ['avg_temp', 'rainfall', 'wind_speed']
fig, axes = plt.subplots(1, len(cols), figsize=(15, 4))

for i, col in enumerate(cols):
    sns.histplot(df1[col], ax=axes[i], kde=True)
    axes[i].set_title(col)

    if df1[col].mean() > df1[col].median():
        print(f"{col} is right skewed")
    elif df1[col].mean() < df1[col].median():
        print(f"{col} is left skewed")
    else:
        print(f"{col} is symmetric")

plt.tight_layout()
plt.show()

df1.groupby('date_of_record')['avg_temp'].mean().plot(label='Temp')
df1.groupby('date_of_record')['rainfall'].mean().plot(label='Rainfall')
plt.legend()
plt.title("Time Series Trend")
plt.show()

df1.groupby('state')['avg_temp'].mean().plot(kind='bar', figsize=(14,5))
plt.xticks(rotation=90)
plt.show()

df1.groupby('state')['rainfall'].mean().plot(kind='bar', figsize=(14,5))
plt.xticks(rotation=90)
plt.show()

df1.groupby('season')['avg_temp'].mean().plot(kind='bar', figsize=(14,5))
plt.xticks(rotation=90)
plt.show()

df1.groupby('season')['rainfall'].mean().plot(kind='bar', figsize=(14,5))
plt.xticks(rotation=90)
plt.show()

df1.groupby('month')['avg_temp'].mean().plot(kind='bar', figsize=(14,5))
plt.xticks(rotation=90)
plt.show()

df1.groupby('month')['rainfall'].mean().plot(kind='bar', figsize=(14,5))
plt.xticks(rotation=90)
plt.show()

fig, axes = plt.subplots(3, 3, figsize=(15, 12))

axes[0, 0].scatter(df1['avg_temp'], df1['rainfall'])
axes[0, 0].set_title("Temp vs Rainfall")
axes[0, 0].set_xlabel("Average Temperature")
axes[0, 0].set_ylabel("Rainfall")

axes[0, 1].scatter(df1['avg_temp'], df1['wind_speed'])
axes[0, 1].set_title("Temp vs Wind")
axes[0, 1].set_xlabel("Average Temperature")
axes[0, 1].set_ylabel("Wind Speed")

axes[0, 2].scatter(df1['elevation'], df1['avg_temp'])
axes[0, 2].set_title("Elevation vs Temp")
axes[0, 2].set_xlabel("Elevation")
axes[0, 2].set_ylabel("Average Temperature")

axes[1, 0].scatter(df1['month'], df1['avg_temp'])
axes[1, 0].set_title("Month vs Temp")
axes[1, 0].set_xlabel("Month")
axes[1, 0].set_ylabel("Average Temperature")

axes[2, 0].scatter(df1['month'], df1['rainfall'])
axes[2, 0].set_title("Month vs Rainfall")
axes[2, 0].set_xlabel("Month")
axes[2, 0].set_ylabel("Rainfall")

sns.boxplot(x='season', y='avg_temp', data=df1, ax=axes[1, 1])
axes[1, 1].set_title("Season vs Temp")
axes[1, 1].set_xlabel("Season")
axes[1, 1].set_ylabel("Average Temperature")

sns.boxplot(x='state', y='avg_temp', data=df1, ax=axes[1, 2])
axes[1, 2].set_title("State vs Temp")
axes[1, 2].set_xlabel("State")
axes[1, 2].set_ylabel("Average Temperature")

sns.boxplot(x='season', y='rainfall', data=df1, ax=axes[2, 1])
axes[2, 1].set_title("Season vs Rainfall")
axes[2, 1].set_xlabel("Season")
axes[2, 1].set_ylabel("Rainfall")

sns.boxplot(x='state', y='rainfall', data=df1, ax=axes[2, 2])
axes[2, 2].set_title("State vs Rainfall")
axes[2, 2].set_xlabel("State")
axes[2, 2].set_ylabel("Rainfall")

plt.tight_layout()
plt.show()

corr = df1.corr(numeric_only=True)
sns.heatmap(corr, annot=True)
plt.show()

sns.boxplot(x=df1['avg_temp'])
plt.show()
sns.boxplot(x=df1['rainfall'])
plt.show()

Q1 = df1['rainfall'].quantile(0.25)
Q3 = df1['rainfall'].quantile(0.75)
IQR = Q3 - Q1
outliers = df1[(df1['rainfall'] < Q1 - 1.5*IQR) | (df1['rainfall'] > Q3 + 1.5*IQR)]
print("Rainfall outliers:", outliers.shape[0])

Q1 = df1['avg_temp'].quantile(0.25)
Q3 = df1['avg_temp'].quantile(0.75)
IQR = Q3 - Q1
outliers = df1[(df1['avg_temp'] < Q1 - 1.5*IQR) | (df1['avg_temp'] > Q3 + 1.5*IQR)]
print("Avg Temp outliers:", outliers.shape[0])

print("Correlation of avg_temp: \n", corr['avg_temp'].sort_values())
print("Correlation of rainfall: \n", corr['rainfall'].sort_values())