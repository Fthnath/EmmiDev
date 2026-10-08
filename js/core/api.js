import { CONFIG } from '../config.js';
import { Storage } from './storage.js';

const memCache = new Map();

async function cachedFetch(url, cacheMs = 600000) {
    const key = `cache::${url}`;
    const now = Date.now();
    if (memCache.has(key)) {
        const { data, expires } = memCache.get(key);
        if (expires > now) return data;
    }
    const stored = Storage.get(key);
    if (stored && stored.expires > now) {
        memCache.set(key, stored);
        return stored.data;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    const entry = { data, expires: now + cacheMs };
    memCache.set(key, entry);
    Storage.set(key, entry);
    return data;
}

export async function searchCities(query, limit = 8) {
    if (!query || query.length < 2) return [];
    const url = `${CONFIG.OPEN_METEO_GEO}/search?name=${encodeURIComponent(query)}&count=${limit}&language=en&format=json`;
    const data = await cachedFetch(url, CONFIG.CACHE.GEOCODING);
    return (data.results || []).map(r => ({
        name: r.name,
        country: r.country_code || r.country,
        countryName: r.country,
        state: r.admin1 || '',
        lat: r.latitude,
        lon: r.longitude,
        timezone: r.timezone,
        population: r.population || 0
    }));
}

export async function reverseGeocode(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        const addr = data.address || {};
        return {
            name: addr.city || addr.town || addr.village || addr.county || 'Unknown',
            country: (addr.country_code || '').toUpperCase(),
            countryName: addr.country || '',
            state: addr.state || '',
            lat, lon
        };
    } catch (err) {
        console.warn('[API] Reverse geocoding failed:', err);
        return { name: 'Unknown', country: '', lat, lon };
    }
}

export async function fetchWeather(lat, lon, units = 'metric') {
    const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
    const windUnit = units === 'imperial' ? 'mph' : 'kmh';
    const precipUnit = units === 'imperial' ? 'inch' : 'mm';
    const url = `${CONFIG.OPEN_METEO_BASE}/forecast?` + new URLSearchParams({
        latitude: lat, longitude: lon,
        current: ['temperature_2m','relative_humidity_2m','apparent_temperature','is_day','precipitation','rain','weather_code','cloud_cover','pressure_msl','surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m'].join(','),
        hourly: ['temperature_2m','relative_humidity_2m','apparent_temperature','precipitation_probability','precipitation','weather_code','cloud_cover','wind_speed_10m','wind_direction_10m','uv_index','is_day'].join(','),
        daily: ['weather_code','temperature_2m_max','temperature_2m_min','apparent_temperature_max','apparent_temperature_min','sunrise','sunset','uv_index_max','precipitation_sum','precipitation_probability_max','wind_speed_10m_max','wind_direction_10m_dominant'].join(','),
        timezone: 'auto',
        temperature_unit: tempUnit,
        wind_speed_unit: windUnit,
        precipitation_unit: precipUnit,
        forecast_days: 10
    }).toString();
    return cachedFetch(url, CONFIG.CACHE.WEATHER);
}

export async function fetchAirQuality(lat, lon) {
    const url = `${CONFIG.OPEN_METEO_AQ}/air-quality?` + new URLSearchParams({
        latitude: lat, longitude: lon,
        current: ['european_aqi','us_aqi','pm10','pm2_5','carbon_monoxide','nitrogen_dioxide','sulphur_dioxide','ozone','alder_pollen','birch_pollen','grass_pollen','mugwort_pollen','olive_pollen','ragweed_pollen','dust','uv_index'].join(','),
        timezone: 'auto'
    }).toString();
    return cachedFetch(url, CONFIG.CACHE.WEATHER);
}

export async function fetchHistorical(lat, lon, startDate, endDate, units = 'metric') {
    const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
    const url = `${CONFIG.OPEN_METEO_ARCHIVE}/archive?` + new URLSearchParams({
        latitude: lat, longitude: lon,
        start_date: startDate, end_date: endDate,
        daily: ['temperature_2m_max','temperature_2m_min','temperature_2m_mean','precipitation_sum','wind_speed_10m_max','weather_code'].join(','),
        timezone: 'auto',
        temperature_unit: tempUnit
    }).toString();
    return cachedFetch(url, CONFIG.CACHE.HISTORICAL);
}

export function weatherCodeToCondition(code) {
    if (code == null) return 'unknown';
    if (code === 0) return 'clear';
    if (code <= 3) return 'clouds';
    if (code <= 48) return 'fog';
    if (code <= 57) return 'drizzle';
    if (code <= 67) return 'rain';
    if (code <= 77) return 'snow';
    if (code <= 82) return 'rain';
    if (code <= 86) return 'snow';
    if (code <= 99) return 'thunderstorm';
    return 'unknown';
}

export function weatherCodeToDescription(code) {
    const map = {
        0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
        45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Moderate drizzle',
        55:'Dense drizzle',56:'Freezing drizzle',57:'Freezing drizzle',
        61:'Slight rain',63:'Moderate rain',65:'Heavy rain',
        66:'Freezing rain',67:'Heavy freezing rain',
        71:'Slight snow',73:'Moderate snow',75:'Heavy snow',77:'Snow grains',
        80:'Rain showers',81:'Rain showers',82:'Violent rain showers',
        85:'Snow showers',86:'Heavy snow showers',
        95:'Thunderstorm',96:'Thunderstorm + hail',99:'Thunderstorm + heavy hail'
    };
    return map[code] || 'Unknown';
}
