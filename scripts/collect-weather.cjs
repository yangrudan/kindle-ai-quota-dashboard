'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fetchJson, isoBeijing, writeAtomic } = require('../src/lib/common.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'config', 'weather.json');
const latitude = process.env.WEATHER_LAT || '30.2741';
const longitude = process.env.WEATHER_LON || '120.1551';
const place = process.env.WEATHER_PLACE || '杭州';

function weatherName(code) {
  const value = Number(code);
  if (value === 0) return ['晴', 'clear'];
  if (value <= 3) return ['多云', 'cloudy'];
  if (value === 45 || value === 48) return ['雾', 'fog'];
  if (value >= 51 && value <= 67) return ['雨', 'rain'];
  if (value >= 71 && value <= 77) return ['雪', 'snow'];
  if (value >= 80 && value <= 82) return ['阵雨', 'rain'];
  if (value >= 85 && value <= 86) return ['阵雪', 'snow'];
  if (value >= 95) return ['雷雨', 'thunder'];
  return ['天气', 'cloudy'];
}

function windName(degrees) {
  const names = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
  const value = Number(degrees);
  return Number.isFinite(value) ? names[Math.round(value / 45) % 8] : '';
}

async function main() {
  const query = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m',
    timezone: 'Asia/Shanghai',
  });
  const payload = await fetchJson(`https://api.open-meteo.com/v1/forecast?${query}`);
  const current = payload && payload.current;
  if (!current) throw new Error('Open-Meteo 响应缺少 current');
  const [description, iconKey] = weatherName(current.weather_code);
  const value = {
    description,
    iconKey,
    tempC: Number(current.temperature_2m),
    feelsLikeC: Number(current.apparent_temperature),
    humidity: Number(current.relative_humidity_2m),
    windKph: Number(current.wind_speed_10m),
    windDir: windName(current.wind_direction_10m),
    place,
    observedAt: isoBeijing(`${current.time}+08:00`),
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeAtomic(output, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`weather updated: ${place}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
