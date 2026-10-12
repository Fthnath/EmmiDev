/**
 * EmmiDev Weather — Weather Module
 * Live data from Open-Meteo, rendering current/hourly/daily + lifestyle.
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { AppState } from '../core/state.js';
import { Bus, Events } from '../core/events.js';
import { fetchWeather, fetchAirQuality, fetchHistorical, weatherCodeToCondition, weatherCodeToDescription } from '../core/api.js';
import { formatTemp, formatWind, formatPercent, formatPressure, formatRain, windDirection } from '../utils/format.js';
import { formatTime, formatDay, formatShort } from '../utils/date.js';
import { Toast } from '../ui/toast.js';
import { i18n } from '../ui/i18n.js';
import { LocationManager, formatLocationLabel } from './locations.js';

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
        this.aq = null;
        this.container = null;
        this.historyRequestId = 0;
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
            const [weather, aq] = await Promise.all([
                fetchWeather(location.lat, location.lon, units, { refresh }),
                fetchAirQuality(location.lat, location.lon, { refresh }).catch(() => null)
            ]);

            this.data = weather;
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

        // Hero
        this.renderHero(cur, loc, tempUnit);
        // Current card
        this.renderCurrentCard(cur, data, loc, tempUnit, units);
        // Hourly
        this.renderHourly(data.hourly, tempUnit);
        // Daily
        this.renderDaily(daily, tempUnit);
        // Full forecast view
        this.renderForecastFull(daily, tempUnit);
        // Charts
        this.renderCharts(data, tempUnit);
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
            el('heroFeelsLike').textContent = `Feels ${Math.round(cur.apparent_temperature)}°`;
        }
        if (el('heroWind')) {
            el('heroWind').textContent = formatWind(cur.wind_speed_10m, Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric'));
        }
        if (el('heroHumidity')) {
            el('heroHumidity').textContent = `${Math.round(cur.relative_humidity_2m)}%`;
        }
        if (el('heroUpdated')) {
            el('heroUpdated').textContent = 'Updated now';
        }
    }

    renderCurrentCard(cur, data, loc, tempUnit, units) {
        const card = document.getElementById('currentWeatherCard');
        if (!card) return;

        const cond = this.currentCondition(cur);
        const desc = this.currentDescription(cur);
        const icon = this.weatherIcon(cond, cur.is_day === 1);
        const today = data.daily;

        card.innerHTML = `
            <div class="current-weather-card">
                <div class="current-weather-header">
                    <div>
                        <h3>${this.esc(formatLocationLabel(loc))}</h3>
                        <p>${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                    </div>
                    <div style="font-size:0.85rem;opacity:0.9;text-align:right">
                        <div><i class="fas fa-arrow-up"></i> ${Math.round(today.temperature_2m_max[0])}°</div>
                        <div><i class="fas fa-arrow-down"></i> ${Math.round(today.temperature_2m_min[0])}°</div>
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

    renderHourly(hourly, tempUnit) {
        const container = document.getElementById('hourlyForecast');
        if (!container) return;

        // Next 24 hours
        const now = new Date();
        const startIdx = Math.max(0, hourly.time.findIndex(t => new Date(t) >= now));
        const slice = hourly.time.slice(startIdx, startIdx + 24);

        container.innerHTML = slice.map((t, i) => {
            const idx = startIdx + i;
            const d = new Date(t);
            const temp = Math.round(hourly.temperature_2m[idx]);
            const code = hourly.weather_code[idx];
            const pop = Math.round(hourly.precipitation_probability?.[idx] ?? 0);
            const cond = weatherCodeToCondition(code);
            const isDay = hourly.is_day?.[idx] === 1;
            const icon = this.weatherIcon(cond, isDay);

            const label = i === 0 ? 'Now' : formatTime(d);

            return `
                <div class="hourly-item">
                    <div class="hourly-time">${label}</div>
                    <div class="hourly-icon"><i class="${icon}"></i></div>
                    <div class="hourly-temp">${temp}°</div>
                    ${pop > 10 ? `<div class="hourly-precip"><i class="fas fa-droplet"></i> ${pop}%</div>` : ''}
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

            const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDay(d);

            return `
                <div class="daily-item">
                    <div class="daily-day">${dayLabel}</div>
                    <div class="daily-date">${formatShort(d)}</div>
                    <div class="daily-icon"><i class="${icon}"></i></div>
                    <div class="daily-temp-high">${hi}°</div>
                    <div class="daily-temp-low">${lo}°</div>
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

            return `
                <div class="daily-item">
                    <div class="daily-day">${i === 0 ? 'Today' : formatDay(d)}</div>
                    <div class="daily-date">${formatShort(d)}</div>
                    <div class="daily-icon"><i class="${icon}"></i></div>
                    <div class="daily-temp-high">${hi}° / <span style="font-size:0.8rem;color:var(--text-muted)">${lo}°</span></div>
                    ${pop > 10 ? `<div class="daily-precip"><i class="fas fa-droplet"></i> ${pop}%</div>` : ''}
                    ${rain > 0.1 ? `<div style="font-size:0.75rem;color:var(--primary)">${formatRain(rain)}</div>` : ''}
                </div>
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
            this._tempChart = new Chart(tempCtx, {
                type: 'line',
                data: {
                    labels: daily.time.map(t => formatShort(t)),
                    datasets: [
                        {
                            label: `High (°${tempUnit})`,
                            data: daily.temperature_2m_max,
                            borderColor: '#ff6b01',
                            backgroundColor: 'rgba(255,107,1,0.12)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 5,
                            pointBackgroundColor: '#ff6b01'
                        },
                        {
                            label: `Low (°${tempUnit})`,
                            data: daily.temperature_2m_min,
                            borderColor: '#4a9eff',
                            backgroundColor: 'rgba(74,158,255,0.12)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 5,
                            pointBackgroundColor: '#4a9eff'
                        }
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

        // Humidity chart (hourly 24h)
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

    resizeCharts() {
        this._tempChart?.resize();
        this._humChart?.resize();
        this._climateChart?.resize();
    }

    renderLifestyle(data) {
        const container = document.getElementById('lifestyleCards');
        if (!container) return;

        const cur = data.current;
        const temp = cur.temperature_2m;
        const cond = this.currentCondition(cur);
        const humidity = cur.relative_humidity_2m;

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

    renderQuickHealth(data, aq) {
        this.renderHealth(data, aq);
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
