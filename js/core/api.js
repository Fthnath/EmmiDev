import { CONFIG } from '../config.js';
import { Storage } from './storage.js';

const memCache = new Map();
const pendingRequests = new Map();

function getCachedEntry(key, now = Date.now()) {
    const entry = memCache.get(key) || Storage.get(key);
    if (!entry || !entry.data || !Number.isFinite(entry.expires)) return null;
    return entry.expires > now ? entry : null;
}

function isNetworkError(err) {
    if (!err) return false;
    if (typeof err === 'string') return /network|failed to fetch|offline|load failed/i.test(err);
    return /network|failed to fetch|offline|load failed/i.test(String(err.message || err));
}

async function cachedFetch(url, cacheMs = 600000) {
    const key = `cache::${url}`;
    const now = Date.now();
    const freshEntry = getCachedEntry(key, now);
    if (freshEntry) return freshEntry.data;

    if (pendingRequests.has(key)) return pendingRequests.get(key);

    const request = (async () => {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                const cached = Storage.get(key) || memCache.get(key);
                if (cached && cached.data) return cached.data;
                throw new Error(`HTTP ${res.status}: ${res.statusText || 'Request failed'}`);
            }
            const data = await res.json();
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new Error('API returned an invalid response');
            }
            const entry = { data, expires: Date.now() + cacheMs };
            memCache.set(key, entry);
            Storage.set(key, entry);
            return data;
        } catch (err) {
            const cached = Storage.get(key) || memCache.get(key);
            if (cached && cached.data && isNetworkError(err)) {
                memCache.set(key, cached);
                return cached.data;
            }

            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            if (isOffline && cached && cached.data) {
                memCache.set(key, cached);
                return cached.data;
            }

            if (err instanceof TypeError || isNetworkError(err)) {
                throw new Error('Network unavailable. Please check your connection and try again.');
            }
            throw err;
        }
    })();

    pendingRequests.set(key, request);
    try {
        return await request;
    } finally {
        pendingRequests.delete(key);
    }
}

function validateCoordinates(lat, lon) {
    const toCoordinate = value => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string' && value.trim()) return Number(value);
        return NaN;
    };
    const latitude = toCoordinate(lat);
    const longitude = toCoordinate(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180) {
        throw new TypeError('Latitude and longitude must be valid coordinates');
    }
    return { lat: latitude, lon: longitude };
}

export async function searchCities(query, limit = 8) {
    const name = typeof query === 'string' ? query.trim() : '';
    if (name.length < 2) return [];
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError('City search limit must be an integer from 1 to 100');
    }
    const url = `${CONFIG.OPEN_METEO_GEO}/search?name=${encodeURIComponent(name)}&count=${limit}&language=en&format=json`;
    const data = await cachedFetch(url, CONFIG.CACHE.GEOCODING);
    if (data.results != null && !Array.isArray(data.results)) {
        throw new Error('Geocoding API returned invalid city results');
    }
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
    const coords = validateCoordinates(lat, lon);
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lon}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error(`Reverse geocoding failed (HTTP ${res.status})`);
    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Reverse geocoding returned an invalid response');
    }
    const addr = data.address || {};
    return {
        name: addr.city || addr.town || addr.village || addr.county || 'Unknown',
        country: (addr.country_code || '').toUpperCase(),
        countryName: addr.country || '',
        state: addr.state || '',
        ...coords
    };
}

export async function fetchWeather(lat, lon, units = 'metric') {
    const coords = validateCoordinates(lat, lon);
    if (units !== 'metric' && units !== 'imperial') {
        throw new TypeError('Units must be "metric" or "imperial"');
    }
    const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
    const windUnit = units === 'imperial' ? 'mph' : 'kmh';
    const precipUnit = units === 'imperial' ? 'inch' : 'mm';
    const url = `${CONFIG.OPEN_METEO_BASE}/forecast?` + new URLSearchParams({
        latitude: coords.lat, longitude: coords.lon,
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
    const coords = validateCoordinates(lat, lon);
    const url = `${CONFIG.OPEN_METEO_AQ}/air-quality?` + new URLSearchParams({
        latitude: coords.lat, longitude: coords.lon,
        current: ['european_aqi','us_aqi','pm10','pm2_5','carbon_monoxide','nitrogen_dioxide','sulphur_dioxide','ozone','alder_pollen','birch_pollen','grass_pollen','mugwort_pollen','olive_pollen','ragweed_pollen','dust','uv_index'].join(','),
        timezone: 'auto'
    }).toString();
    return cachedFetch(url, CONFIG.CACHE.WEATHER);
}

export async function fetchHistorical(lat, lon, startDate, endDate, units = 'metric') {
    const coords = validateCoordinates(lat, lon);
    if (units !== 'metric' && units !== 'imperial') {
        throw new TypeError('Units must be "metric" or "imperial"');
    }
    const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) {
        throw new RangeError('Historical date range must use valid YYYY-MM-DD dates in order');
    }
    const tempUnit = units === 'imperial' ? 'fahrenheit' : 'celsius';
    const url = `${CONFIG.OPEN_METEO_ARCHIVE}/archive?` + new URLSearchParams({
        latitude: coords.lat, longitude: coords.lon,
        start_date: startDate, end_date: endDate,
        daily: ['temperature_2m_max','temperature_2m_min','temperature_2m_mean','precipitation_sum','wind_speed_10m_max','weather_code'].join(','),
        timezone: 'auto',
        temperature_unit: tempUnit
    }).toString();
    return cachedFetch(url, CONFIG.CACHE.HISTORICAL);
}

export function weatherCodeToCondition(code) {
    if (!Number.isInteger(code) || code < 0 || code > 99) return 'unknown';
    if (code === 0) return 'clear';
    if (code <= 3) return 'clouds';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code >= 61 && code <= 67) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 80 && code <= 82) return 'rain';
    if (code >= 85 && code <= 86) return 'snow';
    if (code >= 95) return 'thunderstorm';
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
