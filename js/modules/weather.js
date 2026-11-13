/**
 * EmmiDev Weather — Weather Module
 * Live data from Open-Meteo, rendering current/hourly/daily + lifestyle.
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { AppState } from '../core/state.js';
import { Bus, Events } from '../core/events.js';
import { fetchWeather, fetchPrecipitationNowcast, fetchAirQuality, fetchHistorical, weatherCodeToCondition, weatherCodeToDescription } from '../core/api.js';
import { formatTemp, formatWind, formatPercent, formatPressure, windDirection } from '../utils/format.js';
import { formatTime, formatDay, formatShort } from '../utils/date.js';
import { Toast } from '../ui/toast.js';
import { i18n } from '../ui/i18n.js';
import { LocationManager, formatLocationLabel } from './locations.js';
import { ShareCard } from './share-card.js';   // NEW

const FARM_CROPS = {
    maize: { name: 'Maize', minTemp: 18, maxTemp: 32, plantingMonths: [2, 3, 7, 8], guidance: 'Avoid waterlogged soil; check moisture before sowing.' },
    beans: { name: 'Beans', minTemp: 16, maxTemp: 28, plantingMonths: [2, 3, 7, 8], guidance: 'Steady moisture is especially useful during flowering and pod formation.' },
    cassava: { name: 'Cassava', minTemp: 20, maxTemp: 32, plantingMonths: [1, 2, 7, 8, 9], guidance: 'Use healthy planting material and avoid waterlogged ground.' },
    groundnuts: { name: 'Groundnuts', minTemp: 20, maxTemp: 32, plantingMonths: [2, 3, 7, 8], guidance: 'Well-drained soil helps reduce pod and root problems.' },
    rice: { name: 'Rice', minTemp: 20, maxTemp: 35, plantingMonths: [2, 3, 8, 9], guidance: 'Rainfall alone does not confirm field water availability; check irrigation and drainage.' },
    coffee: { name: 'Coffee', minTemp: 18, maxTemp: 30, plantingMonths: [2, 3, 7, 8], guidance: 'Young plants benefit from shade, mulch, and moisture during establishment.' }
};

class WeatherModule {
    constructor() {
        this.data = null;
        this.nowcast = null;
        this.aq = null;
        this.container = null;
        this.historyRequestId = 0;
        this.hourlyFeelsLike = false;
        this.forecastFeelsLike = false;
        this.showMeteogram = false;   // NEW
    }

    init() {
        this.bindUI();
        console.log('[Weather] Ready');
    }

    bindUI() {
        // Hero search input
        const heroSearch = document.getElementById('heroSearchInput');
        const suggestBox = document.getElementById('searchSuggestions');
        if (heroSearch && suggestBox) {
            this.wireSearch(heroSearch, suggestBox);
        }

        // Use my location button
        const geoBtn = document.getElementById('useMyLocation');
        if (geoBtn) {
            geoBtn.addEventListener('click', () => this.useMyLocation());
        }

        // Hourly feels-like toggle
        document.getElementById('hourlyFeelsLikeToggle')?.addEventListener('click', (event) => {
            this.hourlyFeelsLike = !this.hourlyFeelsLike;
            event.currentTarget.setAttribute('aria-pressed', String(this.hourlyFeelsLike));
            if (this.data) {
                const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
                this.renderHourly(this.data.hourly, units === 'imperial' ? 'F' : 'C', this.data.daily);
            }
        });

        // Forecast feels-like toggle
        document.getElementById('forecastFeelsLikeToggle')?.addEventListener('click', (event) => {
            this.forecastFeelsLike = !this.forecastFeelsLike;
            event.currentTarget.setAttribute('aria-pressed', String(this.forecastFeelsLike));
            if (this.data) {
                this.renderCharts(this.data, Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial' ? 'F' : 'C');
            }
        });

        // NEW: Meteogram toggle
        document.getElementById('meteogramToggle')?.addEventListener('click', (event) => {
            this.showMeteogram = !this.showMeteogram;
            event.currentTarget.setAttribute('aria-pressed', String(this.showMeteogram));
            const tempWrapper = document.getElementById('tempChart')?.closest('.chart-container');
            const meteoWrapper = document.getElementById('meteogramContainer');
            if (tempWrapper) tempWrapper.hidden = this.showMeteogram;
            if (meteoWrapper) meteoWrapper.hidden = !this.showMeteogram;
            if (this.showMeteogram && this.data) {
                this.renderMeteogram(this.data, Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial' ? 'F' : 'C');
            }
        });

        // NEW: Share button in current weather card (delegated — rendered dynamically)
        document.addEventListener('click', (e) => {
            if (e.target.closest('#shareCardBtn')) {
                e.preventDefault();
                ShareCard.share();
            }
        });

        window.setInterval(() => this.updateNowcastMessage(), 60 * 1000);

        // Crop selector
        const cropSelect = document.getElementById('farmCropSelect');
        if (cropSelect) {
            cropSelect.value = this.selectedCrop();
            cropSelect.addEventListener('change', () => {
                const profile = Storage.get(CONFIG.STORAGE_KEYS.FARM_PROFILE, {});
                const savedProfile = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
                Storage.set(CONFIG.STORAGE_KEYS.FARM_PROFILE, { ...savedProfile, crop: cropSelect.value });
                if (this.data) this.renderFarming(this.data);
            });
        }

        document.getElementById('historyRange')?.addEventListener('change', () => this.loadHistory());
        document.getElementById('historyRefreshBtn')?.addEventListener('click', () => this.loadHistory({ refresh: true }));
        Bus.on(Events.LOCATION_CHANGED, () => {
            if (document.querySelector('.view[data-view="history"]')?.classList.contains('view-active')) {
                this.loadHistory();
            }
        });

        // React to unit changes
        Bus.on(Events.UNITS_CHANGED, () => {
            if (this.data) this.render(this.data);
        });
    }

    wireSearch(input, suggestBox) {
        let debounceTimer;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const q = input.value.trim();
            if (q.length < 2) {
                this.showRecentSuggestions(suggestBox);
                return;
            }
            debounceTimer = setTimeout(async () => {
                const cities = await LocationManager.search(q);
                this.renderSuggestions(suggestBox, cities);
            }, 300);
        });

        input.addEventListener('focus', () => {
            const q = input.value.trim();
            if (q.length < 2) this.showRecentSuggestions(suggestBox);
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-bar')) {
                suggestBox.classList.remove('active');
            }
        });
    }

    showRecentSuggestions(container) {
        const recents = LocationManager.getRecent();
        if (!recents.length) {
            container.classList.remove('active');
            return;
        }
        container.innerHTML = `
            <div class="suggest-header">${i18n.t('search.recent')}</div>
            ${recents.map(c => `
                <div class="suggestion-item"
                    data-lat="${c.lat}" data-lon="${c.lon}"
                    data-name="${this.esc(c.name)}"
                    data-country="${this.esc(c.country || '')}">
                    <i class="fas fa-history"></i>
                    <span>${this.esc(c.name)}${c.country ? ', ' + this.esc(c.country) : ''}</span>
                </div>
            `).join('')}
        `;
        this.wireSuggestions(container);
        container.classList.add('active');
    }

    renderSuggestions(container, cities) {
        if (!cities.length) {
            container.classList.remove('active');
            return;
        }
        container.innerHTML = cities.map(c => `
            <div class="suggestion-item"
                data-lat="${c.lat}" data-lon="${c.lon}"
                data-name="${this.esc(c.name)}"
                data-country="${this.esc(c.country)}"
                data-state="${this.esc(c.state || '')}">
                <i class="fas fa-map-marker-alt"></i>
                <span>${this.esc(c.name)}${c.state ? ', ' + this.esc(c.state) : ''}, ${this.esc(c.country)}</span>
            </div>
        `).join('');
        this.wireSuggestions(container);
        container.classList.add('active');
    }

    wireSuggestions(container) {
        container.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const city = {
                    name: item.dataset.name,
                    country: item.dataset.country,
                    state: item.dataset.state || '',
                    source: 'search',
                    lat: parseFloat(item.dataset.lat),
                    lon: parseFloat(item.dataset.lon)
                };
                LocationManager.pushRecent(city);
                LocationManager.add(city, true);
                LocationManager.setActive(city);
                container.classList.remove('active');
                const input = document.getElementById('heroSearchInput');
                if (input) input.value = '';
            });
        });
    }

    async useMyLocation() {
        if (!('geolocation' in navigator)) {
            Toast.error('Geolocation not supported');
            return;
        }
        Toast.info('Locating you...', 2000);
        try {
            const pos = await new Promise((resolve, reject) =>
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 0
                })
            );
            const loc = await LocationManager.addFromCoords(
                pos.coords.latitude,
                pos.coords.longitude,
                { accuracy: pos.coords.accuracy }
            );
            Toast.success(`Location: ${formatLocationLabel(loc)}`);
        } catch (err) {
            const message = err.code === 1
                ? 'Allow location access for this site in your browser settings.'
                : err.code === 3
                    ? 'Location detection timed out. Check that location services are enabled.'
                    : 'Could not get your location. Check your browser permission and device location settings.';
            Toast.error(message);
        }
    }

    async loadFor(location, { refresh = false, quiet = false } = {}) {
        if (!location) return;
        console.log('[Weather] Loading for', location.name);

        AppState.set('loading', true);
        if (!quiet) this.renderLoading();

        try {
            const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
            const [weather, aq, nowcast] = await Promise.all([
                fetchWeather(location.lat, location.lon, units, { refresh }),
                fetchAirQuality(location.lat, location.lon, { refresh }).catch(() => null),
                fetchPrecipitationNowcast(location.lat, location.lon, units, { refresh }).catch(err => {
                    console.warn('[Weather] 15-minute precipitation forecast unavailable:', err.message);
                    return null;
                })
            ]);

            this.data = weather;
            this.nowcast = nowcast;
            this.aq = aq;
            this.location = location;

            AppState.set('currentWeather', weather);
            AppState.set('airQuality', aq);
            AppState.set('forecast', weather);
            AppState.set('activeLocation', location);

            this.render(weather);
            this.renderHealth(weather, aq);
            this.updateScene(weather, location);
            this.renderLifestyle(weather);
            this.renderFarming(weather);
            this.renderHeroAdvice(weather);        // NEW
            this.renderHeroDeltas(weather);        // NEW
            this.renderRightNowStrip(weather, aq); // NEW
            this.checkSevereAlerts(weather);       // NEW

            // Persist last location
            Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_LOCATION, location);

            Bus.emit(Events.WEATHER_LOADED, { weather, aq, location });
        } catch (err) {
            console.error('[Weather] Load error:', err);
            if (quiet) {
                console.warn('[Weather] Background refresh failed; keeping the last successful data.');
            } else {
                Toast.error('Could not load weather data');
                this.renderError(err.message);
            }
        } finally {
            AppState.set('loading', false);
        }
    }

    // ============ RENDER ============

    renderLoading() {
        const hero = {
            temp: document.getElementById('heroTemp'),
            desc: document.getElementById('heroDesc'),
            loc: document.getElementById('heroLocationName')
        };
        if (hero.temp) hero.temp.textContent = '--';
        if (hero.desc) hero.desc.textContent = 'Loading...';

        const card = document.getElementById('currentWeatherCard');
        if (card) {
            card.innerHTML = `
                <div class="card">
                    <div class="card-body" style="text-align:center;padding:48px 24px">
                        <div class="loader"></div>
                        <p style="color:var(--text-muted);margin-top:16px">Fetching weather...</p>
                    </div>
                </div>
            `;
        }
    }

    renderError(msg) {
        const card = document.getElementById('currentWeatherCard');
        if (card) {
            card.innerHTML = `
                <div class="card">
                    <div class="card-body" style="text-align:center;padding:48px 24px">
                        <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:var(--danger);margin-bottom:16px"></i>
                        <p style="color:var(--text-muted)">${this.esc(msg || 'Failed to load weather')}</p>
                    </div>
                </div>
            `;
        }
    }

    render(data) {
        const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
        const tempUnit = units === 'imperial' ? 'F' : 'C';
        const cur = data.current;
        const daily = data.daily;
        const loc = this.location || LocationManager.getActive();

        this.renderHero(cur, loc, tempUnit);
        this.renderNowcast(this.nowcast, units);
        this.renderCurrentCard(cur, data, loc, tempUnit, units);
        this.renderHourly(data.hourly, tempUnit, daily);
        this.renderDaily(daily, tempUnit);
        this.renderForecastFull(daily, tempUnit);
        this.renderCharts(data, tempUnit);
        this.renderWindRose(data, tempUnit);   // NEW
    }

    renderHero(cur, loc, tempUnit) {
        const temp = Math.round(cur.temperature_2m);
        const cond = this.currentCondition(cur);
        const desc = this.currentDescription(cur);

        const el = (id) => document.getElementById(id);

        if (el('heroTemp')) el('heroTemp').textContent = temp;
        if (el('heroTempUnit')) el('heroTempUnit').textContent = `°${tempUnit}`;
        if (el('heroDesc')) el('heroDesc').textContent = desc;
        if (el('heroLocationName')) {
            el('heroLocationName').textContent = loc
                ? formatLocationLabel(loc)
                : 'Unknown';
        }
        if (el('heroFeelsLike')) {
            el('heroFeelsLike').textContent = `${Math.round(cur.apparent_temperature)}°${tempUnit}`;
        }
        if (el('heroWind')) {
            el('heroWind').textContent = formatWind(cur.wind_speed_10m, Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric'));
        }
        if (el('heroHumidity')) {
            el('heroHumidity').textContent = `${Math.round(cur.relative_humidity_2m)}%`;
        }
        if (el('heroUpdated')) {
            el('heroUpdated').textContent = 'Just now';
        }
        // NEW: Pressure
        if (el('heroPressure')) {
            const p = Number(cur.pressure_msl);
            el('heroPressure').textContent = Number.isFinite(p) ? `${Math.round(p)} hPa` : '-- hPa';
        }
        // NEW: Visibility
        if (el('heroVisibility')) {
            const v = Number(cur.visibility);
            const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
            if (Number.isFinite(v)) {
                el('heroVisibility').textContent = units === 'imperial'
                    ? `${(v / 1609.344).toFixed(1)} mi`
                    : `${(v / 1000).toFixed(1)} km`;
            } else {
                el('heroVisibility').textContent = '-- km';
            }
        }
    }

    /* ============================================================
       NEW: HERO ADVICE (one-line actionable tip)
       ============================================================ */
    renderHeroAdvice(data) {
        const el = document.getElementById('heroAdviceText');
        if (!el) return;

        const cur = data.current;
        const temp = Number(cur.temperature_2m);
        const cond = this.currentCondition(cur);
        const uv = Number(data.daily?.uv_index_max?.[0]);
        const precipProb = Number(data.hourly?.precipitation_probability?.[0]) || 0;

        let advice = '';
        if (cond === 'thunderstorm') {
            advice = 'Thunderstorm outside — stay indoors if you can';
        } else if (cond === 'rain' || cond === 'drizzle') {
            advice = 'Grab an umbrella before heading out';
        } else if (cond === 'snow') {
            advice = 'Snow expected — bundle up and drive carefully';
        } else if (cond === 'fog') {
            advice = 'Low visibility — drive carefully';
        } else if (precipProb >= 60) {
            advice = `Rain likely soon (${precipProb}%) — carry an umbrella`;
        } else if (temp >= 33) {
            advice = 'Very hot outside — drink water and avoid midday sun';
        } else if (temp >= 28) {
            advice = 'Warm day — stay hydrated and use sunscreen';
        } else if (temp <= 5) {
            advice = 'Bundle up — cold weather outside';
        } else if (uv >= 8) {
            advice = 'Very high UV — sunscreen, hat, and shade recommended';
        } else if (uv >= 6) {
            advice = 'High UV — use sun protection outdoors';
        } else if (temp >= 18 && temp <= 26 && cond === 'clear') {
            advice = 'Perfect weather — great day to be outside';
        } else {
            advice = 'Comfortable conditions — enjoy your day';
        }

        el.textContent = advice;
    }

    /* ============================================================
       NEW: HERO DELTAS (trend + feels-like comparison)
       ============================================================ */
    renderHeroDeltas(data) {
        const trendEl = document.getElementById('heroTrendDelta');
        const feelsEl = document.getElementById('heroFeelsDelta');
        const hourly = data.hourly;
        const cur = data.current;
        const tempUnit = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial' ? 'F' : 'C';

        // Trend: compare now vs 1 hour ago
        if (trendEl && hourly?.time) {
            const now = new Date();
            const idx = hourly.time.findIndex(t => new Date(t) >= now);
            const prevIdx = Math.max(0, idx - 1);
            const nowTemp = Number(hourly.temperature_2m?.[idx]);
            const prevTemp = Number(hourly.temperature_2m?.[prevIdx]);

            if (Number.isFinite(nowTemp) && Number.isFinite(prevTemp)) {
                const delta = nowTemp - prevTemp;
                const absDelta = Math.abs(delta);
                const arrow = trendEl.querySelector('i');
                const span = trendEl.querySelector('span');

                if (absDelta < 0.5) {
                    arrow.className = 'fas fa-minus';
                    trendEl.classList.remove('is-up', 'is-down');
                    span.textContent = 'Steady';
                } else if (delta > 0) {
                    arrow.className = 'fas fa-arrow-up';
                    trendEl.classList.add('is-up');
                    trendEl.classList.remove('is-down');
                    span.textContent = `+${absDelta.toFixed(1)}° in 1h`;
                } else {
                    arrow.className = 'fas fa-arrow-down';
                    trendEl.classList.add('is-down');
                    trendEl.classList.remove('is-up');
                    span.textContent = `-${absDelta.toFixed(1)}° in 1h`;
                }
            }
        }

        // Feels-like vs actual
        if (feelsEl) {
            const actual = Number(cur.temperature_2m);
            const feels = Number(cur.apparent_temperature);
            if (Number.isFinite(actual) && Number.isFinite(feels)) {
                const diff = feels - actual;
                const absDiff = Math.abs(diff);
                const arrow = feelsEl.querySelector('i');
                const span = feelsEl.querySelector('span');

                if (absDiff < 1) {
                    arrow.className = 'fas fa-equals';
                    feelsEl.classList.remove('is-up', 'is-down');
                    span.textContent = 'Matches';
                } else if (diff > 0) {
                    arrow.className = 'fas fa-temperature-high';
                    feelsEl.classList.add('is-up');
                    feelsEl.classList.remove('is-down');
                    span.textContent = `Feels ${absDiff.toFixed(0)}° warmer`;
                } else {
                    arrow.className = 'fas fa-temperature-low';
                    feelsEl.classList.add('is-down');
                    feelsEl.classList.remove('is-up');
                    span.textContent = `Feels ${absDiff.toFixed(0)}° cooler`;
                }
            }
        }
    }

    /* ============================================================
       NEW: RIGHT NOW STRIP (5 glanceable items)
       ============================================================ */
    renderRightNowStrip(data, aq) {
        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        const cur = data.current;
        const temp = Number(cur.temperature_2m);
        const cond = this.currentCondition(cur);
        const uv = Number(data.daily?.uv_index_max?.[0]);
        const precipProb = Number(data.hourly?.precipitation_probability?.[0]) || 0;

        // Trend
        if (cond === 'rain' || cond === 'thunderstorm') set('rightNowTrend', 'Rainy');
        else if (temp >= 30) set('rightNowTrend', 'Hot');
        else if (temp <= 10) set('rightNowTrend', 'Cold');
        else set('rightNowTrend', 'Mild');

        // Outdoor
        if (cond === 'thunderstorm') set('rightNowOutdoor', 'Stay in');
        else if (cond === 'rain') set('rightNowOutdoor', 'Rainy');
        else if (temp >= 33 || uv >= 8) set('rightNowOutdoor', 'Limit');
        else if (temp >= 18 && temp <= 26) set('rightNowOutdoor', 'Great');
        else set('rightNowOutdoor', 'Okay');

        // Rain
        if (cond === 'rain') set('rightNowRain', 'Now');
        else if (precipProb >= 60) set('rightNowRain', `${precipProb}%`);
        else if (precipProb >= 30) set('rightNowRain', `${precipProb}%`);
        else set('rightNowRain', 'Dry');

        // UV
        if (!Number.isFinite(uv)) set('rightNowUV', '—');
        else if (uv >= 8) set('rightNowUV', 'Extreme');
        else if (uv >= 6) set('rightNowUV', 'High');
        else if (uv >= 3) set('rightNowUV', 'Moderate');
        else set('rightNowUV', 'Low');

        // Sleep (tonight's comfort)
        const hourly = data.hourly;
        if (hourly?.time) {
            const tonight = new Date();
            tonight.setHours(22, 0, 0, 0);
            if (tonight < new Date()) tonight.setDate(tonight.getDate() + 1);

            const nightTemps = [];
            hourly.time.forEach((t, idx) => {
                const d = new Date(t);
                if (d >= tonight && d < new Date(tonight.getTime() + 8 * 60 * 60 * 1000)) {
                    const val = Number(hourly.apparent_temperature?.[idx]);
                    if (Number.isFinite(val)) nightTemps.push(val);
                }
            });

            if (nightTemps.length > 0) {
                const avg = nightTemps.reduce((s, v) => s + v, 0) / nightTemps.length;
                if (avg >= 16 && avg <= 21) set('rightNowSleep', 'Ideal');
                else if (avg > 26) set('rightNowSleep', 'Too warm');
                else if (avg > 21) set('rightNowSleep', 'Warm');
                else if (avg < 14) set('rightNowSleep', 'Cold');
                else set('rightNowSleep', 'Fair');
            } else {
                set('rightNowSleep', '—');
            }
        }
    }

    /* ============================================================
       NEW: SEVERE WEATHER ALERTS
       ============================================================ */
    checkSevereAlerts(data) {
        const banner = document.getElementById('severeAlertBanner');
        if (!banner) return;

        const cur = data.current;
        const daily = data.daily;
        const cond = this.currentCondition(cur);
        const windKmh = Number(cur.wind_speed_10m) || 0;
        const gustKmh = Number(cur.wind_gusts_10m) || 0;

        // Check for severe conditions
        let alert = null;

        if (cond === 'thunderstorm') {
            alert = {
                title: '⛈️ Thunderstorm Alert',
                message: 'Thunderstorms in your area. Avoid open spaces and unplug sensitive electronics.'
            };
        } else if (gustKmh >= 80) {
            alert = {
                title: '💨 High Wind Warning',
                message: `Wind gusts up to ${Math.round(gustKmh)} km/h. Secure loose items outdoors.`
            };
        } else if (daily?.precipitation_sum?.[0] >= 50) {
            alert = {
                title: '🌧️ Heavy Rain Alert',
                message: `Heavy rainfall expected today (${Math.round(daily.precipitation_sum[0])} mm). Watch for flooding.`
            };
        } else if (Number(cur.visibility) < 200) {
            alert = {
                title: '🌫️ Low Visibility',
                message: 'Visibility below 200m. Drive carefully and use fog lights.'
            };
        } else if (Number(cur.temperature_2m) >= 40) {
            alert = {
                title: '🔥 Extreme Heat Warning',
                message: 'Temperatures above 40°C. Stay indoors, drink water, and check on elderly neighbors.'
            };
        } else if (Number(cur.temperature_2m) <= -5) {
            alert = {
                title: '❄️ Extreme Cold Warning',
                message: 'Temperatures below -5°C. Bundle up and limit time outdoors.'
            };
        }

        if (alert) {
            document.getElementById('severeAlertTitle').textContent = alert.title;
            document.getElementById('severeAlertMessage').textContent = alert.message;
            banner.hidden = false;

            // Dismiss handler (only once)
            const dismiss = document.getElementById('severeAlertDismiss');
            if (dismiss && !dismiss._wired) {
                dismiss._wired = true;
                dismiss.addEventListener('click', () => {
                    banner.hidden = true;
                });
            }
        } else {
            banner.hidden = true;
        }
    }

    renderNowcast(nowcast, units) {
        const timeline = document.getElementById('nowcastTimeline');
        const source = document.getElementById('nowcastSource');
        if (!timeline) return;

        this.nowcastTimezone = nowcast?.timezone || undefined;
        const time = nowcast?.minutely_15?.time;
        const precipitation = nowcast?.minutely_15?.precipitation;
        const offsetSeconds = Number(nowcast?.utc_offset_seconds || 0);
        const startIndex = Array.isArray(time)
            ? time.findIndex(value => this.parseForecastTimestamp(value, offsetSeconds) >= Date.now())
            : -1;

        if (!Array.isArray(time) || !Array.isArray(precipitation) || startIndex < 0) {
            this.nowcastSteps = [];
            timeline.innerHTML = '';
            if (source) source.textContent = '';
            const alert = document.getElementById('nowcastAlert');
            if (alert) {
                alert.className = 'nowcast-alert nowcast-unavailable';
                alert.textContent = i18n.t('nowcast.unavailable');
            }
            return;
        }

        this.nowcastSteps = time.slice(startIndex, startIndex + 4).map((value, index) => ({
            time: this.parseForecastTimestamp(value, offsetSeconds),
            amount: Number(precipitation[startIndex + index])
        })).filter(step => Number.isFinite(step.time) && Number.isFinite(step.amount));
        this.nowcastPrecipUnit = nowcast.minutely_15_units?.precipitation || (units === 'imperial' ? 'inch' : 'mm');
        if (source) source.textContent = i18n.t('nowcast.source');

        timeline.innerHTML = this.nowcastSteps.map((step, index) => {
            const amountPerHour = step.amount * 4;
            const wetThreshold = this.nowcastPrecipUnit === 'inch' ? 0.001 : 0.02;
            const intensity = step.amount < wetThreshold
                ? 'dry'
                : amountPerHour < (this.nowcastPrecipUnit === 'inch' ? 0.1 : 2.5)
                    ? 'light'
                    : amountPerHour < (this.nowcastPrecipUnit === 'inch' ? 0.3 : 7.5)
                        ? 'moderate'
                        : 'heavy';
            const amount = this.nowcastPrecipUnit === 'inch'
                ? `${step.amount.toFixed(3)} in`
                : `${step.amount.toFixed(1)} mm`;
            return `<div class="nowcast-step ${intensity}" title="${this.formatNowcastTime(step.time)} · ${amount}">
                <span class="nowcast-step-label">${index === 0 ? 'Now' : this.formatNowcastTime(step.time)}</span>
                <span class="nowcast-step-track"><i></i></span>
                <span class="nowcast-step-amount">${amount}</span>
            </div>`;
        }).join('');

        this.updateNowcastPlayhead();
        this.updateNowcastMessage();
    }

    parseForecastTimestamp(value, offsetSeconds = Number(this.data?.utc_offset_seconds || 0)) {
        const timestamp = String(value);
        if (/[zZ]|[+-]\d{2}:\d{2}$/.test(timestamp)) return new Date(timestamp).getTime();
        const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return new Date(timestamp).getTime();
        const [, year, month, day, hour, minute, second = '0'] = match;
        return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - offsetSeconds * 1000;
    }

    formatNowcastTime(timestamp) {
        try {
            return new Intl.DateTimeFormat(undefined, {
                hour: 'numeric',
                minute: '2-digit',
                ...((this.nowcastTimezone || this.data?.timezone)
                    ? { timeZone: this.nowcastTimezone || this.data.timezone }
                    : {})
            }).format(new Date(timestamp));
        } catch (err) {
            console.warn('[Weather] Could not format nowcast time zone:', err.message);
            return formatTime(timestamp);
        }
    }

    updateNowcastPlayhead() {
        const track = document.querySelector('#nowcastTimeline .nowcast-step-track');
        if (!track || !this.nowcastSteps?.length) return;
        const interval = 15 * 60 * 1000;
        const periodStart = this.nowcastSteps[0].time - interval;
        const progress = Math.max(0, Math.min(100, ((Date.now() - periodStart) / interval) * 100));
        track.style.setProperty('--nowcast-progress', `${progress}%`);
    }

    updateNowcastMessage() {
        if (!this.nowcastSteps?.length) return;
        this.updateNowcastPlayhead();
        const alert = document.getElementById('nowcastAlert');
        if (!alert) return;

        const wetThreshold = this.nowcastPrecipUnit === 'inch' ? 0.001 : 0.02;
        const now = Date.now();
        const nextRain = this.nowcastSteps.find(step => step.time > now - 60_000 && step.amount >= wetThreshold);
        if (!nextRain) {
            alert.className = 'nowcast-alert nowcast-dry';
            alert.innerHTML = `<i class="fas fa-cloud-sun" aria-hidden="true"></i><span>${i18n.t('nowcast.dry')}</span>`;
            return;
        }

        const minutes = Math.max(0, Math.ceil((nextRain.time - now) / 60_000));
        const rainIndex = this.nowcastSteps.indexOf(nextRain);
        const stopIndex = this.nowcastSteps.findIndex((step, index) =>
            index > rainIndex && step.amount < wetThreshold
        );
        const stopMinutes = stopIndex > rainIndex
            ? Math.max(15, Math.ceil((this.nowcastSteps[stopIndex].time - now) / 60_000))
            : null;
        const message = rainIndex === 0 && minutes <= 1 && stopMinutes
            ? i18n.t('nowcast.rainEnding', { minutes: stopMinutes })
            : minutes <= 1
                ? i18n.t('nowcast.rainNow')
                : i18n.t('nowcast.rainIn', { minutes });
        alert.className = 'nowcast-alert nowcast-rain';
        alert.innerHTML = `<i class="fas fa-cloud-rain" aria-hidden="true"></i><span>${this.esc(message)}</span>`;
    }

    renderCurrentCard(cur, data, loc, tempUnit, units) {
        const card = document.getElementById('currentWeatherCard');
        if (!card) return;

        const cond = this.currentCondition(cur);
        const desc = this.currentDescription(cur);
        const icon = this.weatherIcon(cond, cur.is_day === 1);
        const today = data.daily;

        // FIXED: proper template with share button inline (not pasted snippet)
        card.innerHTML = `
            <div class="current-weather-card">
                <div class="current-weather-header">
                    <div>
                        <h3>${this.esc(formatLocationLabel(loc))}</h3>
                        <p>${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                    </div>
                    <button class="current-weather-share-btn" id="shareCardBtn" type="button" title="Share this weather" aria-label="Share this weather">
                        <i class="fas fa-share-nodes"></i>
                    </button>
                    <div style="font-size:0.85rem;opacity:0.9;text-align:right">
                        <div><i class="fas fa-arrow-up"></i> ${Math.round(today.temperature_2m_max[0])}°${tempUnit}</div>
                        <div><i class="fas fa-arrow-down"></i> ${Math.round(today.temperature_2m_min[0])}°${tempUnit}</div>
                    </div>
                </div>

                <div class="current-weather-body">
                    <div class="current-weather-icon">
                        <i class="${icon}"></i>
                    </div>
                    <div>
                        <div class="current-weather-temp">${Math.round(cur.temperature_2m)}°${tempUnit}</div>
                        <div class="current-weather-desc">${this.esc(desc)}</div>
                        <div style="color:var(--text-muted);font-size:0.9rem">
                            ${i18n.t('current.feelsLike')}: ${Math.round(cur.apparent_temperature)}°${tempUnit}
                        </div>
                    </div>

                    <div class="weather-details-grid">
                        <div class="weather-detail">
                            <i class="fas fa-wind"></i>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${i18n.t('current.wind')}</div>
                                <div><strong>${formatWind(cur.wind_speed_10m, units)}</strong>
                                <span style="font-size:0.8rem">${windDirection(cur.wind_direction_10m)}</span></div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${i18n.t('forecast.gusts')}: ${formatWind(cur.wind_gusts_10m, units)}</div>
                            </div>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-tint"></i>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${i18n.t('current.humidity')}</div>
                                <div><strong>${Math.round(cur.relative_humidity_2m)}%</strong></div>
                            </div>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-compress-alt"></i>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${i18n.t('current.pressure')}</div>
                                <div><strong>${formatPressure(cur.pressure_msl)}</strong></div>
                            </div>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-cloud"></i>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">Cloud cover</div>
                                <div><strong>${Math.round(cur.cloud_cover || 0)}%</strong></div>
                            </div>
                        </div>
                        ${cur.visibility != null && Number.isFinite(Number(cur.visibility)) ? `
                        <div class="weather-detail">
                            <i class="fas fa-eye"></i>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${i18n.t('current.visibility')}</div>
                                <div><strong>${units === 'imperial'
                                    ? `${(cur.visibility / 1609.344).toFixed(1)} mi`
                                    : `${(cur.visibility / 1000).toFixed(1)} km`}</strong></div>
                            </div>
                        </div>` : ''}
                        <div class="weather-detail">
                            <i class="fas fa-sun"></i>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${i18n.t('current.uvIndex')}</div>
                                <div><strong>${(today.uv_index_max?.[0] ?? '--').toFixed ? today.uv_index_max[0].toFixed(0) : '--'}</strong></div>
                            </div>
                        </div>
                        <div class="weather-detail">
                            <i class="fas fa-sun"></i>
                            <div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${i18n.t('current.sunrise')} / ${i18n.t('current.sunset')}</div>
                                <div><strong>${formatTime(today.sunrise[0])} / ${formatTime(today.sunset[0])}</strong></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderHourly(hourly, tempUnit, daily) {
        const container = document.getElementById('hourlyForecast');
        if (!container) return;

        const now = new Date();
        const foundStartIdx = hourly.time.findIndex(t =>
            this.parseForecastTimestamp(t) >= now.getTime()
        );
        const startIdx = foundStartIdx < 0
            ? Math.max(0, hourly.time.length - 1)
            : foundStartIdx;
        const slice = hourly.time.slice(startIdx, startIdx + 24);
        const firstTime = this.parseForecastTimestamp(slice[0]);
        const lastTime = this.parseForecastTimestamp(slice[slice.length - 1]);
        const windUnits = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
        const gustThreshold = windUnits === 'imperial' ? 25 : 40;
        const sunEvents = (daily?.time || []).flatMap((date, index) =>
            ['sunrise', 'sunset'].map(type => ({
                type,
                time: daily[type]?.[index],
                label: type === 'sunrise' ? i18n.t('forecast.sunrise') : i18n.t('forecast.sunset')
            }))
        ).filter(event => {
            const time = this.parseForecastTimestamp(event.time);
            return Number.isFinite(time) && time >= firstTime && time <= lastTime;
        }).sort((a, b) => this.parseForecastTimestamp(a.time) - this.parseForecastTimestamp(b.time));
        let nextSunEvent = 0;

        container.innerHTML = slice.map((t, i) => {
            const idx = startIdx + i;
            const forecastTime = this.parseForecastTimestamp(t);
            const tempValues = this.hourlyFeelsLike && Array.isArray(hourly.apparent_temperature)
                ? hourly.apparent_temperature
                : hourly.temperature_2m;
            const temp = Math.round(tempValues[idx]);
            const code = hourly.weather_code[idx];
            const pop = Math.round(hourly.precipitation_probability?.[idx] ?? 0);
            const cond = weatherCodeToCondition(code);
            const isDay = hourly.is_day?.[idx] === 1;
            const icon = this.weatherIcon(cond, isDay);
            const wind = Number(hourly.wind_speed_10m?.[idx]);
            const gust = Number(hourly.wind_gusts_10m?.[idx]);
            const direction = Number(hourly.wind_direction_10m?.[idx]);

            const label = i === 0 ? 'Now' : this.formatNowcastTime(forecastTime);
            let marker = '';
            while (nextSunEvent < sunEvents.length &&
                this.parseForecastTimestamp(sunEvents[nextSunEvent].time) <= forecastTime) {
                const event = sunEvents[nextSunEvent++];
                const eventTime = this.parseForecastTimestamp(event.time);
                marker += `<div class="hourly-sun-marker ${event.type}" aria-label="${event.label} ${this.formatNowcastTime(eventTime)}">
                    <i class="fas ${event.type === 'sunrise' ? 'fa-sun' : 'fa-moon'}" aria-hidden="true"></i>
                    <span>${event.label}</span>
                    <strong>${this.formatNowcastTime(eventTime)}</strong>
                </div>`;
            }

            return `
                ${marker}
                <div class="hourly-item">
                    <div class="hourly-time">${label}</div>
                    <div class="hourly-icon"><i class="${icon}"></i></div>
                    <div class="hourly-temp">${temp}°${tempUnit}</div>
                    <div class="hourly-precip"><i class="fas fa-droplet"></i> ${pop}%</div>
                    <div class="hourly-precip-track" role="img" aria-label="${i18n.t('forecast.rainChance')}: ${pop}%">
                        <span style="height:${pop}%"></span>
                    </div>
                    ${Number.isFinite(direction) ? `<div class="hourly-wind">
                        <i class="fas fa-arrow-up" style="transform:rotate(${direction}deg)" aria-label="${this.esc(windDirection(direction))}"></i>
                        <span class="${Number.isFinite(gust) && gust >= gustThreshold ? 'wind-strong' : ''}">${Number.isFinite(wind) ? this.esc(formatWind(wind, windUnits)) : '--'}</span>
                    </div>` : ''}
                </div>
            `;
        }).join('');
    }

    renderDaily(daily, tempUnit) {
        const container = document.getElementById('dailyForecast');
        if (!container) return;

        container.innerHTML = daily.time.slice(0, 10).map((t, i) => {
            const d = new Date(t);
            const code = daily.weather_code[i];
            const cond = weatherCodeToCondition(code);
            const icon = this.weatherIcon(cond, true);
            const hi = Math.round(daily.temperature_2m_max[i]);
            const lo = Math.round(daily.temperature_2m_min[i]);
            const pop = Math.round(daily.precipitation_probability_max?.[i] ?? 0);

            const dayLabel = i === 0
                ? i18n.t('forecast.today')
                : i === 1
                    ? i18n.t('forecast.tomorrow')
                    : formatDay(d);

            return `
                <div class="daily-item">
                    <div class="daily-day">${dayLabel}</div>
                    <div class="daily-date">${formatShort(d)}</div>
                    <div class="daily-icon"><i class="${icon}"></i></div>
                    <div class="daily-temp-high">${hi}°${tempUnit}</div>
                    <div class="daily-temp-low">${lo}°${tempUnit}</div>
                    ${pop > 10 ? `<div class="daily-precip"><i class="fas fa-droplet"></i> ${pop}%</div>` : ''}
                </div>
            `;
        }).join('');
    }

    renderForecastFull(daily, tempUnit) {
        const container = document.getElementById('forecastFull');
        if (!container) return;
        container.innerHTML = daily.time.map((t, i) => {
            const d = new Date(t);
            const code = daily.weather_code[i];
            const cond = weatherCodeToCondition(code);
            const icon = this.weatherIcon(cond, true);
            const hi = Math.round(daily.temperature_2m_max[i]);
            const lo = Math.round(daily.temperature_2m_min[i]);
            const pop = Math.round(daily.precipitation_probability_max?.[i] ?? 0);
            const rain = daily.precipitation_sum?.[i] ?? 0;

            const apparentHigh = daily.apparent_temperature_max?.[i];
            const apparentLow = daily.apparent_temperature_min?.[i];
            const windSpeed = daily.wind_speed_10m_max?.[i];
            const windBearing = daily.wind_direction_10m_dominant?.[i];
            const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
            const rainAmount = units === 'imperial' ? `${Number(rain).toFixed(2)} in` : `${Number(rain).toFixed(1)} mm`;

            return `
                <details class="daily-item forecast-expandable">
                    <summary class="forecast-day-summary">
                        <span class="daily-day">${i === 0 ? i18n.t('forecast.today') : formatDay(d)}</span>
                        <span class="daily-date">${formatShort(d)}</span>
                        <span class="daily-icon"><i class="${icon}" aria-hidden="true"></i></span>
                        <span class="daily-temp-high">${hi}°${tempUnit}</span>
                        <span class="daily-temp-low">${lo}°${tempUnit}</span>
                        ${pop > 0 ? `<span class="daily-precip"><i class="fas fa-droplet" aria-hidden="true"></i> ${pop}%</span>` : ''}
                        <i class="fas fa-chevron-down forecast-day-chevron" aria-hidden="true"></i>
                    </summary>
                    <div class="forecast-day-details">
                        <span>${i18n.t('forecast.feelsLike')}: ${Number.isFinite(apparentHigh) ? `${Math.round(apparentHigh)}°${tempUnit}` : '—'} / ${Number.isFinite(apparentLow) ? `${Math.round(apparentLow)}°${tempUnit}` : '—'}</span>
                        <span>${i18n.t('forecast.wind')}: ${Number.isFinite(windSpeed) ? formatWind(windSpeed, Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric')) : '—'}${Number.isFinite(windBearing) ? ` ${windDirection(windBearing)}` : ''}</span>
                        <span>${i18n.t('forecast.precip')}: ${rain > 0 ? rainAmount : `0 ${units === 'imperial' ? 'in' : 'mm'}`} · ${i18n.t('forecast.rainChance')}: ${pop}%</span>
                    </div>
                </details>
            `;
        }).join('');
    }

    renderCharts(data, tempUnit) {
        const chartContainers = document.querySelectorAll('.chart-container');
        if (!window.Chart) {
            console.error('[Weather] Chart.js did not load; forecast charts are unavailable.');
            chartContainers.forEach(container => {
                let status = container.querySelector('.chart-status');
                if (!status) {
                    status = document.createElement('p');
                    status.className = 'chart-status';
                    status.setAttribute('role', 'status');
                    container.appendChild(status);
                }
                status.textContent = 'Charts could not load. Check your connection and refresh the page.';
            });
            return;
        }
        chartContainers.forEach(container => container.querySelector('.chart-status')?.remove());

        // Temperature chart
        const tempCtx = document.getElementById('tempChart');
        if (tempCtx) {
            if (this._tempChart) this._tempChart.destroy();
            const daily = data.daily;
            const feelsLikeDatasets = [
                {
                    label: `${i18n.t('forecast.feelsLikeTemperature')} high (°${tempUnit})`,
                    data: daily.apparent_temperature_max,
                    borderColor: '#dc6a35',
                    borderDash: [6, 4],
                    fill: false,
                    tension: 0.35,
                    pointRadius: 3,
                    hidden: !this.forecastFeelsLike
                },
                {
                    label: `${i18n.t('forecast.feelsLikeTemperature')} low (°${tempUnit})`,
                    data: daily.apparent_temperature_min,
                    borderColor: '#5686b5',
                    borderDash: [6, 4],
                    fill: false,
                    tension: 0.35,
                    pointRadius: 3,
                    hidden: !this.forecastFeelsLike
                }
            ];
            this._tempChart = new Chart(tempCtx, {
                type: 'line',
                data: {
                    labels: daily.time.map(t => formatShort(t)),
                    datasets: [
                        {
                            label: `${i18n.t('forecast.high')} (°${tempUnit})`,
                            data: daily.temperature_2m_max,
                            borderColor: '#ff6b01',
                            backgroundColor: 'rgba(255,107,1,0.12)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 5,
                            pointBackgroundColor: '#ff6b01'
                        },
                        {
                            label: `${i18n.t('forecast.low')} (°${tempUnit})`,
                            data: daily.temperature_2m_min,
                            borderColor: '#4a9eff',
                            backgroundColor: 'rgba(74,158,255,0.08)',
                            fill: false,
                            tension: 0.4,
                            pointRadius: 5,
                            pointBackgroundColor: '#4a9eff'
                        },
                        ...feelsLikeDatasets
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } },
                    scales: { y: { beginAtZero: false } }
                }
            });
        }

        const precipitationCtx = document.getElementById('precipitationChart');
        if (precipitationCtx) {
            if (this._precipitationChart) this._precipitationChart.destroy();
            this._precipitationChart = new Chart(precipitationCtx, {
                type: 'bar',
                data: {
                    labels: data.daily.time.map(t => formatShort(t)),
                    datasets: [{
                        label: i18n.t('forecast.rainfall'),
                        data: data.daily.precipitation_sum,
                        backgroundColor: 'rgba(26, 115, 232, 0.68)',
                        borderColor: '#1a73e8',
                        borderWidth: 1,
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: context => `${Number(context.raw || 0).toFixed(1)} ${data.daily_units?.precipitation_sum || 'mm'}`
                            }
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: data.daily_units?.precipitation_sum || 'mm' } }
                    }
                }
            });
        }

        // Humidity chart
        const humCtx = document.getElementById('humidityChart');
        if (humCtx) {
            if (this._humChart) this._humChart.destroy();
            const hourly = data.hourly;
            const now = new Date();
            const startIdx = Math.max(0, hourly.time.findIndex(t => new Date(t) >= now));
            const slice = hourly.time.slice(startIdx, startIdx + 24);
            const humidity = hourly.relative_humidity_2m.slice(startIdx, startIdx + 24);

            this._humChart = new Chart(humCtx, {
                type: 'line',
                data: {
                    labels: slice.map(t => formatTime(t)),
                    datasets: [{
                        label: 'Humidity (%)',
                        data: humidity,
                        borderColor: '#4a9eff',
                        backgroundColor: 'rgba(74,158,255,0.15)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { min: 0, max: 100 } }
                }
            });
        }
    }

    /* ============================================================
       NEW: METEOGRAM (combined temp + rain + wind)
       ============================================================ */
    renderMeteogram(data, tempUnit) {
        const canvas = document.getElementById('meteogramChart');
        if (!canvas || !window.Chart) return;

        if (this._meteogramChart) this._meteogramChart.destroy();

        const daily = data.daily;
        const labels = daily.time.map(t => formatShort(t));
        const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');

        this._meteogramChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'line',
                        label: `High (°${tempUnit})`,
                        data: daily.temperature_2m_max,
                        borderColor: '#ff6b01',
                        backgroundColor: 'rgba(255,107,1,0.1)',
                        fill: false,
                        tension: 0.4,
                        pointRadius: 4,
                        yAxisID: 'temp'
                    },
                    {
                        type: 'line',
                        label: `Low (°${tempUnit})`,
                        data: daily.temperature_2m_min,
                        borderColor: '#4a9eff',
                        fill: false,
                        tension: 0.4,
                        pointRadius: 4,
                        yAxisID: 'temp'
                    },
                    {
                        type: 'bar',
                        label: `Rain (${units === 'imperial' ? 'in' : 'mm'})`,
                        data: daily.precipitation_sum,
                        backgroundColor: 'rgba(26, 115, 232, 0.45)',
                        borderColor: '#1a73e8',
                        borderWidth: 1,
                        borderRadius: 4,
                        yAxisID: 'rain'
                    },
                    {
                        type: 'line',
                        label: `Wind max (${units === 'imperial' ? 'mph' : 'km/h'})`,
                        data: daily.wind_speed_10m_max,
                        borderColor: '#a855f7',
                        borderDash: [4, 4],
                        fill: false,
                        tension: 0.4,
                        pointRadius: 2,
                        yAxisID: 'wind'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    temp: { type: 'linear', position: 'left', title: { display: true, text: `Temp (°${tempUnit})` } },
                    rain: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Rain' } },
                    wind: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Wind' }, display: false }
                }
            }
        });
    }

    /* ============================================================
       NEW: WIND ROSE
       ============================================================ */
    renderWindRose(data, tempUnit) {
        const canvas = document.getElementById('windRoseChart');
        if (!canvas || !window.Chart) return;

        if (this._windRoseChart) this._windRoseChart.destroy();

        // Aggregate wind by 8 compass directions
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const sums = [0, 0, 0, 0, 0, 0, 0, 0];
        const counts = [0, 0, 0, 0, 0, 0, 0, 0];
        const daily = data.daily;

        if (daily?.wind_direction_10m_dominant && daily?.wind_speed_10m_max) {
            for (let i = 0; i < daily.time.length; i++) {
                const dir = Number(daily.wind_direction_10m_dominant[i]);
                const speed = Number(daily.wind_speed_10m_max[i]);
                if (!Number.isFinite(dir) || !Number.isFinite(speed)) continue;
                const idx = Math.round(dir / 45) % 8;
                sums[idx] += speed;
                counts[idx] += 1;
            }
        }

        const avg = sums.map((s, i) => counts[i] ? s / counts[i] : 0);

        this._windRoseChart = new Chart(canvas, {
            type: 'polarArea',
            data: {
                labels: dirs,
                datasets: [{
                    label: 'Avg max wind',
                    data: avg,
                    backgroundColor: [
                        'rgba(239, 68, 68, 0.5)',
                        'rgba(249, 115, 22, 0.5)',
                        'rgba(234, 179, 8, 0.5)',
                        'rgba(34, 197, 94, 0.5)',
                        'rgba(6, 182, 212, 0.5)',
                        'rgba(59, 130, 246, 0.5)',
                        'rgba(139, 92, 246, 0.5)',
                        'rgba(236, 72, 153, 0.5)'
                    ],
                    borderColor: '#fff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right' }
                },
                scales: {
                    r: {
                        beginAtZero: true,
                        ticks: { display: false }
                    }
                }
            }
        });
    }

    resizeCharts() {
        this._tempChart?.resize();
        this._precipitationChart?.resize();
        this._humChart?.resize();
        this._climateChart?.resize();
        this._meteogramChart?.resize();
        this._windRoseChart?.resize();
    }

    renderLifestyle(data) {
        const container = document.getElementById('lifestyleCards');
        if (!container) return;

        const cur = data.current;
        const temp = cur.temperature_2m;
        const cond = this.currentCondition(cur);

        const activity = this.activityAdvice(temp, cond);
        const clothing = this.clothingAdvice(temp, cond);
        const food = this.foodAdvice(temp, cond);

        container.innerHTML = `
            <div class="lifestyle-card">
                <div class="lifestyle-icon"><i class="fas fa-running"></i></div>
                <h3>Outdoor Activities</h3>
                <p>${activity.text}</p>
                <ul class="lifestyle-list">
                    ${activity.tips.map(t => `<li><i class="fas fa-check-circle"></i> ${t}</li>`).join('')}
                </ul>
            </div>
            <div class="lifestyle-card">
                <div class="lifestyle-icon"><i class="fas fa-tshirt"></i></div>
                <h3>Clothing</h3>
                <p>${clothing.text}</p>
                <ul class="lifestyle-list">
                    ${clothing.tips.map(t => `<li><i class="fas fa-check-circle"></i> ${t}</li>`).join('')}
                </ul>
            </div>
            <div class="lifestyle-card">
                <div class="lifestyle-icon"><i class="fas fa-utensils"></i></div>
                <h3>Food & Hydration</h3>
                <p>${food.text}</p>
                <ul class="lifestyle-list">
                    ${food.tips.map(t => `<li><i class="fas fa-check-circle"></i> ${t}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    activityAdvice(temp, cond) {
        if (cond === 'thunderstorm') return { text: 'Stay indoors. Thunderstorms are dangerous outdoors.', tips: ['Avoid open areas', 'Unplug electronics', 'Stay away from windows'] };
        if (cond === 'rain' || cond === 'drizzle') return { text: 'Light indoor activities recommended. Carry an umbrella if you must go out.', tips: ['Visit museums or cafés', 'Indoor gym', 'Read a book'] };
        if (temp > 32) return { text: 'Very hot! Limit outdoor activities to early morning or evening.', tips: ['Swim if possible', 'Seek shade', 'Wear light clothing'] };
        if (temp > 24) return { text: 'Perfect weather for outdoor activities!', tips: ['Hiking', 'Cycling', 'Picnics', 'Sports'] };
        if (temp > 15) return { text: 'Pleasant. Great for walking and moderate outdoor exercise.', tips: ['Walking', 'Jogging', 'Outdoor dining'] };
        if (temp > 5) return { text: 'Cool — dress warmly for outdoor time.', tips: ['Brisk walks', 'Layered clothing', 'Warm drinks after'] };
        return { text: 'Cold! Keep outdoor time short and dress heavily.', tips: ['Indoor exercise', 'Heavy layers', 'Warm gloves'] };
    }

    clothingAdvice(temp, cond) {
        const tips = [];
        if (temp > 28) tips.push('Light, breathable fabrics', 'Hat and sunglasses', 'Sunscreen');
        else if (temp > 20) tips.push('T-shirt with light layer', 'Comfortable shoes');
        else if (temp > 10) tips.push('Long sleeves', 'Light jacket or sweater', 'Closed shoes');
        else if (temp > 0) tips.push('Warm sweater', 'Jacket', 'Scarf');
        else tips.push('Heavy coat', 'Gloves and hat', 'Thermal layers');

        if (cond === 'rain' || cond === 'thunderstorm' || cond === 'drizzle') {
            tips.push('Waterproof jacket');
            tips.push('Umbrella');
        }
        if (cond === 'snow') tips.push('Insulated waterproof boots');

        const text = temp > 24 ? 'Light summer clothing is best.' :
                     temp > 15 ? 'Comfortable mild weather clothing.' :
                     temp > 5  ? 'Warm layers recommended.' :
                                 'Heavy winter clothing needed.';

        return { text, tips };
    }

    foodAdvice(temp, cond) {
        const tips = [];
        if (temp > 28) { tips.push('Drink plenty of water', 'Cold smoothies', 'Fresh salads and fruits'); }
        else if (temp > 18) { tips.push('Stay hydrated', 'Light meals', 'Grilled vegetables'); }
        else if (temp > 8) { tips.push('Warm beverages', 'Balanced meals', 'Soups'); }
        else { tips.push('Hot soups and stews', 'Warm tea or coffee', 'Hearty meals'); }

        if (cond === 'rain' || cond === 'thunderstorm') tips.push('Vitamin C for immunity');

        const text = temp > 25 ? 'Stay cool and hydrated.' :
                     temp > 15 ? 'Enjoy fresh, balanced meals.' :
                                 'Warm, comforting foods are ideal.';

        return { text, tips };
    }

    renderHealth(data, aq) {
        if (!data?.current) return;
        const current = data.current;
        const imperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        const apparent = Number(current.apparent_temperature ?? current.temperature_2m);
        const apparentCelsius = imperial ? (apparent - 32) * 5 / 9 : apparent;
        const windSpeedKmh = Number(current.wind_speed_10m) * (imperial ? 1.60934 : 1);
        const heat = this.heatRisk(apparentCelsius);
        const uv = Number(data.daily?.uv_index_max?.[0]);
        const uvRisk = !Number.isFinite(uv)
            ? { level: 'Unavailable', color: '#64748b', advice: 'UV data was not returned for this location.' }
            : uv >= 8
                ? { level: 'Very high', color: '#dc2626', advice: 'Limit midday exposure; use shade, protective clothing, and sunscreen.' }
                : uv >= 6
                    ? { level: 'High', color: '#ea580c', advice: 'Use shade and sun protection when outdoors.' }
                    : uv >= 3
                        ? { level: 'Moderate', color: '#ca8a04', advice: 'Consider sun protection during extended outdoor activity.' }
                        : { level: 'Low', color: '#16a34a', advice: 'Lower UV exposure is forecast; use usual sun protection.' };
        const condition = this.currentCondition(current);
        const weather = condition === 'thunderstorm'
            ? { level: 'Storm', color: '#dc2626', advice: 'Move indoors and avoid exposed areas during thunderstorms.' }
            : ['rain', 'drizzle'].includes(condition)
                ? { level: 'Wet', color: '#2563eb', advice: 'Expect wet surfaces; use rain protection and take care on roads.' }
                : windSpeedKmh >= 40
                    ? { level: 'Windy', color: '#ca8a04', advice: 'Secure loose items and use care around trees or structures.' }
                    : { level: 'Fair', color: '#16a34a', advice: 'No significant rain or high-wind signal in current conditions.' };
        const aqiValue = aq?.current?.european_aqi ?? aq?.current?.us_aqi;
        const air = Number.isFinite(aqiValue)
            ? aqiValue >= 100
                ? { level: 'Elevated', color: '#dc2626', advice: 'Sensitive people may wish to reduce prolonged outdoor exertion.' }
                : aqiValue >= 50
                    ? { level: 'Moderate', color: '#ca8a04', advice: 'People sensitive to air pollution should monitor symptoms outdoors.' }
                    : { level: 'Lower', color: '#16a34a', advice: 'The reported air-quality index is relatively low.' }
            : { level: 'Unavailable', color: '#64748b', advice: 'Air-quality data is not available for this location right now.' };

        const cards = [
            this.riskCard('Heat & hydration', 'fa-temperature-high', heat),
            this.riskCard('UV exposure', 'fa-sun', uvRisk),
            this.riskCard('Weather exposure', 'fa-cloud-rain', weather),
            this.riskCard('Air quality', 'fa-lungs', air)
        ];
        const healthCards = document.getElementById('healthCards');
        const quickCards = document.getElementById('quickHealthCards');
        if (healthCards) healthCards.innerHTML = cards.join('');
        if (quickCards) quickCards.innerHTML = cards.slice(0, 3).join('');
        this.renderAirQuality(aq, uv);
    }

    renderAirQuality(aq, forecastUv) {
        const container = document.getElementById('environmentalHealth');
        if (!container) return;
        const current = aq?.current;
        if (!current) {
            container.innerHTML = `<div class="health-card"><h3 class="health-title">Environmental data unavailable</h3><p class="section-note">Air-quality readings could not be loaded for this location.</p></div>`;
            return;
        }

        const valid = value => value != null && Number.isFinite(Number(value));
        const shown = (value, digits = 1) => valid(value) ? Number(value).toFixed(digits) : 'Not reported';
        const aqi = valid(current.european_aqi) ? Number(current.european_aqi) : valid(current.us_aqi) ? Number(current.us_aqi) : null;
        const level = aqi == null ? 'Unavailable' : aqi >= 100 ? 'Poor' : aqi >= 50 ? 'Moderate' : 'Good';
        const color = aqi == null ? '#64748b' : aqi >= 100 ? '#dc2626' : aqi >= 50 ? '#ca8a04' : '#16a34a';
        const uv = valid(current.uv_index) ? Number(current.uv_index) : forecastUv;
        const pollenFields = ['grass_pollen', 'birch_pollen', 'ragweed_pollen'];
        const pollen = pollenFields.filter(key => valid(current[key]));
        const pollutant = (name, key) => `<li>${name}: ${shown(current[key])}${valid(current[key]) ? ' μg/m³' : ''}</li>`;

        container.innerHTML = `
            <div class="health-card">
                <div class="health-icon" style="color:${color}"><i class="fas fa-lungs"></i></div>
                <h3 class="health-title">Air Quality</h3>
                <div class="health-metrics">
                    <div class="metric"><div class="metric-value" style="color:${color}">${aqi == null ? '—' : Math.round(aqi)}</div><div class="metric-label">AQI</div></div>
                    <div class="metric"><div class="metric-value" style="color:${color}">${level}</div><div class="metric-label">Status</div></div>
                </div>
                <ul class="health-list">
                    ${pollutant('PM2.5', 'pm2_5')}
                    ${pollutant('PM10', 'pm10')}
                    ${pollutant('Ozone', 'ozone')}
                    ${pollutant('Nitrogen dioxide', 'nitrogen_dioxide')}
                </ul>
            </div>
            <div class="health-card">
                <div class="health-icon" style="color:#ca8a04"><i class="fas fa-sun"></i></div>
                <h3 class="health-title">UV Index</h3>
                <div class="health-metrics"><div class="metric"><div class="metric-value">${Number.isFinite(uv) ? uv.toFixed(1) : '—'}</div><div class="metric-label">Current / forecast</div></div></div>
                <p>${!Number.isFinite(uv) ? 'UV data is unavailable.' : uv >= 6 ? 'Use shade and sun protection during peak daylight.' : uv >= 3 ? 'Sun protection may be useful during extended outdoor activity.' : 'Lower UV exposure is currently reported.'}</p>
            </div>
            <div class="health-card">
                <div class="health-icon" style="color:#65a30d"><i class="fas fa-leaf"></i></div>
                <h3 class="health-title">Pollen</h3>
                ${pollen.length ? `<ul class="health-list">${pollen.map(key => `<li>${this.esc(key.replace('_pollen', '').replace('_', ' '))}: ${shown(current[key])} grains/m³</li>`).join('')}</ul>` : '<p>Pollen readings are not reported for this location.</p>'}
            </div>
        `;
    }

    riskCard(title, icon, risk) {
        return `
            <div class="health-card">
                <div class="health-icon" style="color:${risk.color}"><i class="fas ${icon}"></i></div>
                <h3 class="health-title">${title}</h3>
                <div style="font-size:1.35rem;font-weight:800;color:${risk.color};margin:12px 0">${risk.level}</div>
                <p style="color:var(--text-muted);font-size:0.9rem">${risk.advice}</p>
            </div>
        `;
    }

    heatRisk(apparentTemperature) {
        if (!Number.isFinite(Number(apparentTemperature))) return { level: 'Unavailable', color: '#64748b', advice: 'Feels-like temperature is unavailable.' };
        if (apparentTemperature >= 40) return { level: 'Very hot', color: '#dc2626', advice: 'Avoid strenuous activity in direct sun; take breaks and drink water.' };
        if (apparentTemperature >= 35) return { level: 'Hot', color: '#ea580c', advice: 'Prefer shade and reduce strenuous outdoor activity.' };
        if (apparentTemperature >= 30) return { level: 'Warm', color: '#ca8a04', advice: 'Take water and rest breaks during outdoor work.' };
        return { level: 'Typical', color: '#16a34a', advice: 'Use normal precautions and drink water as needed.' };
    }

    selectedCrop() {
        const profile = Storage.get(CONFIG.STORAGE_KEYS.FARM_PROFILE, {});
        const crop = typeof profile === 'string' ? profile : profile?.crop;
        return FARM_CROPS[crop] ? crop : 'maize';
    }

    renderFarming(data) {
        const advisor = document.getElementById('farmAdvisor');
        const calendar = document.getElementById('cropCalendar');
        if (!data?.daily) return;
        const cropKey = this.selectedCrop();
        const crop = FARM_CROPS[cropKey];
        const select = document.getElementById('farmCropSelect');
        if (select && select.value !== cropKey) select.value = cropKey;
        const daily = data.daily;
        const days = Math.min(10, daily.time?.length || 0);
        const rainfall = daily.precipitation_sum || [];
        const rainProbability = daily.precipitation_probability_max || [];
        const rainTotal = rainfall.slice(0, days).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const rainyDays = rainfall.slice(0, days).filter((value, index) => Number(value) >= 1 || Number(rainProbability[index]) >= 40).length;
        const highs = (daily.temperature_2m_max || []).slice(0, days).filter(Number.isFinite);
        const avgHigh = highs.length ? highs.reduce((sum, value) => sum + value, 0) / highs.length : null;
        const imperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        const avgHighCelsius = avgHigh == null ? null : imperial ? (avgHigh - 32) * 5 / 9 : avgHigh;
        const tempUnit = imperial ? '°F' : '°C';
        const temperatureFit = avgHigh == null ? 'Temperature outlook unavailable.'
            : avgHighCelsius > crop.maxTemp ? `Forecast daytime highs average ${avgHigh.toFixed(0)}${tempUnit}, above the general ${crop.name} range.`
                : avgHighCelsius < crop.minTemp ? `Forecast daytime highs average ${avgHigh.toFixed(0)}${tempUnit}, below the general ${crop.name} range.`
                    : `Forecast daytime highs average ${avgHigh.toFixed(0)}${tempUnit}, within the general ${crop.name} range.`;
        const rainOutlook = rainyDays >= 3 && rainTotal >= 15
            ? `${rainyDays} of the next ${days} days show a rain signal (${rainTotal.toFixed(1)} mm forecast). Check soil moisture before planting.`
            : rainyDays <= 1 || rainTotal < 8
                ? `Limited rain is forecast over the next ${days} days (${rainTotal.toFixed(1)} mm). Consider delaying sowing or arranging water.`
                : `Some rain is forecast over the next ${days} days (${rainTotal.toFixed(1)} mm). Recheck the forecast and field moisture before sowing.`;

        if (advisor) {
            advisor.innerHTML = `
                <article class="health-card farm-advice-card"><h3 class="health-title">${crop.name}: next ${days} days</h3><p>${this.esc(rainOutlook)}</p></article>
                <article class="health-card farm-advice-card"><h3 class="health-title">Temperature outlook</h3><p>${this.esc(temperatureFit)}</p><p class="section-note">Forecasts guide planning but cannot measure soil moisture or guarantee rainfall.</p></article>
                <article class="health-card farm-advice-card"><h3 class="health-title">Field note</h3><p>${this.esc(crop.guidance)}</p></article>
                <article class="health-card farm-advice-card"><h3 class="health-title">Active location</h3><p>${this.esc(formatLocationLabel(this.location || LocationManager.getActive()) || 'Location unavailable')}</p><p class="section-note">Use local extension advice and seed guidance for final decisions.</p></article>
            `;
        }

        if (calendar) {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            calendar.innerHTML = `
                <p class="crop-calendar-note">General East African planting windows for ${crop.name}; local rainfall patterns vary.</p>
                <div class="crop-months">${months.map((month, index) => `<div class="crop-month${crop.plantingMonths.includes(index) ? ' crop-month-active' : ''}"><span>${month}</span>${crop.plantingMonths.includes(index) ? '<i class="fas fa-seedling" aria-label="Typical planting window"></i>' : ''}</div>`).join('')}</div>
            `;
        }
    }

    async loadHistory({ refresh = false } = {}) {
        const location = this.location || LocationManager.getActive();
        const status = document.getElementById('historyStatus');
        const container = document.getElementById('historyContent');
        const range = document.getElementById('historyRange');
        if (!location || !container) return;
        const days = Number(range?.value) || 365;
        const requestId = ++this.historyRequestId;
        const refreshButton = document.getElementById('historyRefreshBtn');
        if (refreshButton) refreshButton.disabled = true;
        if (status) status.textContent = 'Loading historical weather…';

        const end = new Date();
        end.setUTCHours(0, 0, 0, 0);
        end.setUTCDate(end.getUTCDate() - 5);
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - days + 1);
        const startDate = start.toISOString().slice(0, 10);
        const endDate = end.toISOString().slice(0, 10);

        try {
            const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
            const result = await fetchHistorical(location.lat, location.lon, startDate, endDate, units, { refresh });
            if (requestId !== this.historyRequestId) return;
            this.renderHistory(result, location, startDate, endDate, units);
            this.renderOnThisDay(result, units);       // NEW
            this.renderExtremeRecords(result, units);  // NEW
            this.renderMonthlyAverages(result, units); // NEW
        } catch (err) {
            if (requestId !== this.historyRequestId) return;
            if (status) status.textContent = `Historical data is unavailable: ${err.message}`;
            container.innerHTML = '';
            this._climateChart?.destroy();
            this._climateChart = null;
            const chartStatus = document.getElementById('climateChartStatus');
            if (chartStatus) {
                chartStatus.hidden = false;
                chartStatus.textContent = 'No historical chart data is available.';
            }
        } finally {
            if (requestId === this.historyRequestId && refreshButton) refreshButton.disabled = false;
        }
    }

    renderHistory(result, location, startDate, endDate, units = 'metric') {
        const daily = result?.daily;
        const status = document.getElementById('historyStatus');
        const container = document.getElementById('historyContent');
        if (!daily?.time?.length || !container) {
            if (status) status.textContent = 'No historical observations were returned for this period.';
            container.innerHTML = '';
            this._climateChart?.destroy();
            this._climateChart = null;
            return;
        }

        const validValues = values => (values || []).filter(value => Number.isFinite(value));
        const means = validValues(daily.temperature_2m_mean);
        const highs = validValues(daily.temperature_2m_max);
        const rainfall = validValues(daily.precipitation_sum);
        const mean = means.length ? means.reduce((sum, value) => sum + value, 0) / means.length : null;
        const totalRain = rainfall.reduce((sum, value) => sum + value, 0);
        const rainyDays = rainfall.filter(value => value >= 1).length;
        const max = highs.length ? Math.max(...highs) : null;
        const unit = units === 'imperial' ? '°F' : '°C';
        const stat = (title, value, note) => `<article class="health-card history-stat"><h3 class="health-title">${title}</h3><div class="history-stat-value">${value}</div><p class="section-note">${note}</p></article>`;
        container.innerHTML = [
            stat('Average temperature', mean == null ? '—' : `${mean.toFixed(1)}${unit}`, `${means.length} daily readings`),
            stat('Highest daily maximum', max == null ? '—' : `${max.toFixed(1)}${unit}`, 'Across the selected period'),
            stat('Rainfall', `${totalRain.toFixed(1)} mm`, `${rainyDays} days with at least 1 mm`)
        ].join('');
        if (status) status.textContent = `${formatLocationLabel(location)} · ${startDate} to ${endDate} · Historical model data`;

        const chartStatus = document.getElementById('climateChartStatus');
        const canvas = document.getElementById('climateChart');
        if (!window.Chart || !canvas) {
            if (chartStatus) {
                chartStatus.hidden = false;
                chartStatus.textContent = 'Chart library is unavailable; summary values are still shown.';
            }
            return;
        }
        if (chartStatus) chartStatus.hidden = true;
        this._climateChart?.destroy();
        this._climateChart = new window.Chart(canvas, {
            type: 'bar',
            data: {
                labels: daily.time,
                datasets: [
                    { type: 'line', label: `Mean temperature (${unit})`, data: daily.temperature_2m_mean || [], borderColor: '#dc6b32', backgroundColor: 'rgba(220,107,50,0.12)', yAxisID: 'temperature', pointRadius: 0, tension: 0.25 },
                    { type: 'bar', label: 'Precipitation (mm)', data: daily.precipitation_sum || [], backgroundColor: 'rgba(37,99,235,0.45)', yAxisID: 'precipitation' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    x: { ticks: { maxTicksLimit: 8 } },
                    temperature: { type: 'linear', position: 'left', title: { display: true, text: unit } },
                    precipitation: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'mm' } }
                }
            }
        });
    }

    /* ============================================================
       NEW: ON THIS DAY
       ============================================================ */
    renderOnThisDay(result, units = 'metric') {
        const container = document.getElementById('onThisDayCard');
        if (!container || !result?.daily?.time?.length) return;

        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const targetPattern = `-${month}-${day}`;

        // Find matching day in historical data
        const idx = result.daily.time.findIndex(t => t.endsWith(targetPattern));
        if (idx < 0) {
            container.innerHTML = `<p class="section-note">No historical record for today's date.</p>`;
            return;
        }

        const unit = units === 'imperial' ? '°F' : '°C';
        const histHigh = Number(result.daily.temperature_2m_max?.[idx]);
        const histLow = Number(result.daily.temperature_2m_min?.[idx]);
        const histRain = Number(result.daily.precipitation_sum?.[idx]) || 0;
        const dateStr = result.daily.time[idx];

        const current = this.data?.daily;
        const todayHigh = Number(current?.temperature_2m_max?.[0]);
        const todayLow = Number(current?.temperature_2m_min?.[0]);

        const deltaHigh = Number.isFinite(todayHigh) && Number.isFinite(histHigh)
            ? (todayHigh - histHigh).toFixed(1) : null;

        container.innerHTML = `
            <div class="on-this-day-side">
                <span class="label">${dateStr}</span>
                <div class="temp">${Number.isFinite(histHigh) ? `${Math.round(histHigh)}°` : '—'}</div>
                <p class="section-note">Last year high</p>
                <p class="section-note">Low ${Number.isFinite(histLow) ? `${Math.round(histLow)}°` : '—'} · Rain ${histRain.toFixed(1)} mm</p>
            </div>
            <div class="on-this-day-arrow">
                ${deltaHigh != null ? `<i class="fas fa-arrow-${deltaHigh >= 0 ? 'up' : 'down'}"></i>` : '<i class="fas fa-equals"></i>'}
            </div>
            <div class="on-this-day-side">
                <span class="label">Today</span>
                <div class="temp">${Number.isFinite(todayHigh) ? `${Math.round(todayHigh)}°` : '—'}</div>
                <p class="section-note">Current forecast high</p>
                ${deltaHigh != null ? `<p class="section-note" style="color:${deltaHigh >= 0 ? '#dc2626' : '#2563eb'};font-weight:600">
                    ${deltaHigh >= 0 ? '+' : ''}${deltaHigh}°${unit} vs last year
                </p>` : ''}
            </div>
        `;
    }

    /* ============================================================
       NEW: EXTREME RECORDS
       ============================================================ */
    renderExtremeRecords(result, units = 'metric') {
        const container = document.getElementById('extremeRecords');
        if (!container || !result?.daily?.time?.length) return;

        const unit = units === 'imperial' ? '°F' : '°C';
        const highs = result.daily.temperature_2m_max || [];
        const lows = result.daily.temperature_2m_min || [];
        const rains = result.daily.precipitation_sum || [];

        let hottest = { temp: -Infinity, date: null };
        let coldest = { temp: Infinity, date: null };
        let wettest = { rain: -Infinity, date: null };

        for (let i = 0; i < result.daily.time.length; i++) {
            const h = Number(highs[i]);
            const l = Number(lows[i]);
            const r = Number(rains[i]);
            if (Number.isFinite(h) && h > hottest.temp) hottest = { temp: h, date: result.daily.time[i] };
            if (Number.isFinite(l) && l < coldest.temp) coldest = { temp: l, date: result.daily.time[i] };
            if (Number.isFinite(r) && r > wettest.rain) wettest = { rain: r, date: result.daily.time[i] };
        }

        const card = (icon, label, value, date, color) => `
            <article class="health-card">
                <div class="health-icon" style="color:${color}"><i class="fas ${icon}"></i></div>
                <h3 class="health-title">${label}</h3>
                <div style="font-size:1.5rem;font-weight:800;color:${color};margin:8px 0">${value}</div>
                <p class="section-note">${date || '—'}</p>
            </article>
        `;

        container.innerHTML = [
            card('fa-temperature-high', 'Hottest day',
                Number.isFinite(hottest.temp) ? `${Math.round(hottest.temp)}${unit}` : '—',
                hottest.date, '#dc2626'),
            card('fa-temperature-low', 'Coldest day',
                Number.isFinite(coldest.temp) ? `${Math.round(coldest.temp)}${unit}` : '—',
                coldest.date, '#2563eb'),
            card('fa-cloud-showers-heavy', 'Wettest day',
                Number.isFinite(wettest.rain) ? `${wettest.rain.toFixed(1)} mm` : '—',
                wettest.date, '#0891b2')
        ].join('');
    }

    /* ============================================================
       NEW: MONTHLY AVERAGES TABLE
       ============================================================ */
    renderMonthlyAverages(result, units = 'metric') {
        const container = document.getElementById('monthlyAveragesTable');
        if (!container || !result?.daily?.time?.length) return;

        const unit = units === 'imperial' ? '°F' : '°C';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const buckets = months.map(() => ({ temps: [], rains: 0, days: 0 }));

        for (let i = 0; i < result.daily.time.length; i++) {
            const d = new Date(result.daily.time[i]);
            const m = d.getMonth();
            const tmax = Number(result.daily.temperature_2m_max?.[i]);
            const tmin = Number(result.daily.temperature_2m_min?.[i]);
            const rain = Number(result.daily.precipitation_sum?.[i]) || 0;

            if (Number.isFinite(tmax) && Number.isFinite(tmin)) {
                buckets[m].temps.push((tmax + tmin) / 2);
            }
            buckets[m].rains += rain;
            buckets[m].days += 1;
        }

        const rows = months.map((m, i) => {
            const b = buckets[i];
            if (b.days === 0) return '';
            const avgTemp = b.temps.length ? b.temps.reduce((s, v) => s + v, 0) / b.temps.length : null;
            return `<tr>
                <td>${m}</td>
                <td>${avgTemp != null ? avgTemp.toFixed(1) + unit : '—'}</td>
                <td>${b.rains.toFixed(1)} mm</td>
                <td>${b.days}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Month</th>
                        <th>Avg Temp</th>
                        <th>Total Rain</th>
                        <th>Days</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    // ============ SCENE ============

    updateScene(data, loc) {
        if (!window.__setWeatherScene) return;
        const cur = data.current;
        const cond = this.currentCondition(cur);
        window.__setWeatherScene({
            condition: cond,
            isDay: cur.is_day === 1,
            temperature: cur.temperature_2m,
            windSpeed: cur.wind_speed_10m || 0,
            weatherCode: cur.weather_code
        });
    }

    currentCondition(current) {
        const hasObservedRain = [current.rain, current.precipitation]
            .some(value => Number.isFinite(Number(value)) && Number(value) > 0);
        return hasObservedRain ? 'rain' : weatherCodeToCondition(current.weather_code);
    }

    currentDescription(current) {
        const codeCondition = weatherCodeToCondition(current.weather_code);
        if (this.currentCondition(current) === 'rain' &&
            !['rain', 'drizzle', 'thunderstorm'].includes(codeCondition)) {
            return 'Rain';
        }
        return weatherCodeToDescription(current.weather_code);
    }

    // ============ HELPERS ============

    weatherIcon(cond, isDay) {
        switch (cond) {
            case 'clear':        return isDay ? 'fas fa-sun' : 'fas fa-moon';
            case 'clouds':       return isDay ? 'fas fa-cloud-sun' : 'fas fa-cloud-moon';
            case 'rain':         return 'fas fa-cloud-rain';
            case 'drizzle':      return 'fas fa-cloud-rain';
            case 'thunderstorm': return 'fas fa-bolt';
            case 'snow':         return 'fas fa-snowflake';
            case 'fog':          return 'fas fa-smog';
            default:             return 'fas fa-cloud';
        }
    }

    esc(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }
}

export const Weather = new WeatherModule();