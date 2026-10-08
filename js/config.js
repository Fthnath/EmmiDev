/**
 * EmmiDev Weather — Configuration
 * Public config only. NO SECRETS HERE.
 * API keys are stored in localStorage via the Settings UI.
 */
import { Storage } from './core/storage.js';

export const CONFIG = {
    APP_NAME: 'EmmiDev Weather',
    APP_VERSION: '2.0.0',
    OPEN_METEO_BASE: 'https://api.open-meteo.com/v1',
    OPEN_METEO_ARCHIVE: 'https://archive-api.open-meteo.com/v1',
    OPEN_METEO_AQ: 'https://air-quality-api.open-meteo.com/v1',
    OPEN_METEO_GEO: 'https://geocoding-api.open-meteo.com/v1',
    RAINVIEWER_API: 'https://api.rainviewer.com/public/weather-maps.json',
    OWM_BASE: 'https://api.openweathermap.org/data/2.5',
    OWM_GEO: 'https://api.openweathermap.org/geo/1.0',
    GROQ_BASE: 'https://api.groq.com/openai/v1',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    STORAGE_KEYS: {
        LOCATIONS: 'emmidev_locations',
        ACTIVE_LOCATION: 'emmidev_active_location',
        RECENT_CITIES: 'emmidev_recent_cities',
        THEME: 'emmidev_theme',
        LANGUAGE: 'emmidev_language',
        UNITS: 'emmidev_units',
        GROQ_KEY: 'emmidev_groq_key',
        OWM_KEY: 'emmidev_owm_key',
        HEALTH_PROFILE: 'emmidev_health_profile',
        FARM_PROFILE: 'emmidev_farm_profile',
        NOTIFICATIONS: 'emmidev_notifications',
        FIRST_VISIT: 'emmidev_first_visit'
    },
    DEFAULT_LANGUAGE: 'en',
    DEFAULT_THEME: 'auto',
    DEFAULT_UNITS: 'metric',
    DEFAULT_LOCATION: { name: 'Kampala', country: 'UG', lat: 0.3476, lon: 32.5825 },
    MAX_LOCATIONS: 20,
    MAX_RECENT_CITIES: 10,
    CACHE: {
        WEATHER: 10 * 60 * 1000,
        FORECAST: 30 * 60 * 1000,
        GEOCODING: 24 * 60 * 60 * 1000,
        HISTORICAL: 7 * 24 * 60 * 60 * 1000
    },
    FEATURES: {
        AI_CHAT: true, FARMING: true, HEALTH: true, RADAR: true,
        MULTI_LANGUAGE: true, NOTIFICATIONS: true, SHARE_CARDS: true
    }
};
export function getApiKey(service) {
    const key = CONFIG.STORAGE_KEYS[service + '_KEY'];
    return key ? Storage.get(key) : null;
}
export function setApiKey(service, value) {
    const key = CONFIG.STORAGE_KEYS[service + '_KEY'];
    return key ? Storage.set(key, value) : false;
}
