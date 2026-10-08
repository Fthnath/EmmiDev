/**
 * EmmiDev Weather — Weather Module
 * Live data from Open-Meteo, rendering current/hourly/daily + lifestyle.
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { AppState } from '../core/state.js';
import { Bus, Events } from '../core/events.js';
import { fetchWeather, fetchAirQuality, weatherCodeToCondition, weatherCodeToDescription } from '../core/api.js';
import { formatTemp, formatWind, formatPercent, formatPressure, formatRain, windDirection } from '../utils/format.js';
import { formatTime, formatDay, formatShort } from '../utils/date.js';
import { Toast } from '../ui/toast.js';
import { i18n } from '../ui/i18n.js';
import { LocationManager } from './locations.js';

class WeatherModule {
    constructor() {
        this.data = null;
        this.aq = null;
        this.container = null;
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
                    timeout: 8000, maximumAge: 5 * 60 * 1000
                })
            );
            const loc = await LocationManager.addFromCoords(
                pos.coords.latitude, pos.coords.longitude
            );
            Toast.success(`Location: ${loc.name}`);
        } catch (err) {
            Toast.error('Could not get your location');
        }
    }

    async loadFor(location) {
        if (!location) return;
        console.log('[Weather] Loading for', location.name);

        AppState.set('loading', true);
        this.renderLoading();

        try {
            const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
            const [weather, aq] = await Promise.all([
                fetchWeather(location.lat, location.lon, units),
                fetchAirQuality(location.lat, location.lon).catch(() => null)
            ]);

            this.data = weather;
            this.aq = aq;
            this.location = location;

            AppState.set('currentWeather', weather);
            AppState.set('airQuality', aq);
            AppState.set('forecast', weather);
            AppState.set('activeLocation', location);

            this.render(weather);
            this.renderAirQuality(aq);
            this.updateScene(weather, location);
            this.renderLifestyle(weather);
            this.renderQuickHealth(weather, aq);

            // Persist last location
            Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_LOCATION, location);

            Bus.emit(Events.WEATHER_LOADED, { weather, aq, location });
        } catch (err) {
            console.error('[Weather] Load error:', err);
            Toast.error('Could not load weather data');
            this.renderError(err.message);
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
        const cond = weatherCodeToCondition(cur.weather_code);
        const desc = weatherCodeToDescription(cur.weather_code);

        const el = (id) => document.getElementById(id);

        if (el('heroTemp')) el('heroTemp').textContent = temp;
        if (el('heroTempUnit')) el('heroTempUnit').textContent = `°${tempUnit}`;
        if (el('heroDesc')) el('heroDesc').textContent = desc;
        if (el('heroLocationName')) {
            el('heroLocationName').textContent = loc
                ? `${loc.name}${loc.country ? ', ' + loc.country : ''}`
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

        const cond = weatherCodeToCondition(cur.weather_code);
        const desc = weatherCodeToDescription(cur.weather_code);
        const icon = this.weatherIcon(cond, cur.is_day === 1);
        const today = data.daily;

        card.innerHTML = `
            <div class="current-weather-card">
                <div class="current-weather-header">
                    <div>
                        <h3>${this.esc(loc.name)}${loc.country ? ', ' + this.esc(loc.country) : ''}</h3>
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
    }

    renderLifestyle(data) {
        const container = document.getElementById('lifestyleCards');
        if (!container) return;

        const cur = data.current;
        const temp = cur.temperature_2m;
        const cond = weatherCodeToCondition(cur.weather_code);
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

    renderAirQuality(aq) {
        if (!aq || !aq.current) return;
        const container = document.getElementById('environmentalHealth');
        if (!container) return;

        const c = aq.current;
        const aqi = c.european_aqi ?? c.us_aqi ?? 0;
        const level = aqi < 20 ? 'Good' : aqi < 40 ? 'Fair' : aqi < 60 ? 'Moderate' : aqi < 80 ? 'Poor' : 'Very Poor';
        const color = aqi < 20 ? '#22c55e' : aqi < 40 ? '#84cc16' : aqi < 60 ? '#f59e0b' : aqi < 80 ? '#ef4444' : '#7c2d12';

        container.innerHTML = `
            <div class="health-card">
                <div class="health-icon" style="color:${color}"><i class="fas fa-lungs"></i></div>
                <h3 class="health-title">Air Quality</h3>
                <div class="health-metrics">
                    <div class="metric">
                        <div class="metric-value" style="color:${color}">${Math.round(aqi)}</div>
                        <div class="metric-label">AQI</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" style="color:${color}">${level}</div>
                        <div class="metric-label">Status</div>
                    </div>
                </div>
                <ul class="health-list">
                    <li>PM2.5: ${(c.pm2_5 ?? 0).toFixed(1)} μg/m³</li>
                    <li>PM10: ${(c.pm10 ?? 0).toFixed(1)} μg/m³</li>
                    <li>O₃: ${(c.ozone ?? 0).toFixed(1)} μg/m³</li>
                    <li>NO₂: ${(c.nitrogen_dioxide ?? 0).toFixed(1)} μg/m³</li>
                </ul>
            </div>
            <div class="health-card">
                <div class="health-icon" style="color:#f59e0b"><i class="fas fa-sun"></i></div>
                <h3 class="health-title">UV Index</h3>
                <div class="health-metrics">
                    <div class="metric">
                        <div class="metric-value">${Math.round(c.uv_index ?? 0)}</div>
                        <div class="metric-label">UV</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${(c.uv_index ?? 0) < 3 ? 'Low' : (c.uv_index ?? 0) < 6 ? 'Moderate' : (c.uv_index ?? 0) < 8 ? 'High' : 'Very High'}</div>
                        <div class="metric-label">Risk</div>
                    </div>
                </div>
                <ul class="health-list">
                    <li>${(c.uv_index ?? 0) > 3 ? 'Apply sunscreen' : 'Minimal sun protection needed'}</li>
                    <li>Wear sunglasses if outdoors</li>
                </ul>
            </div>
            <div class="health-card">
                <div class="health-icon" style="color:#84cc16"><i class="fas fa-leaf"></i></div>
                <h3 class="health-title">Pollen</h3>
                <div class="health-metrics">
                    <div class="metric">
                        <div class="metric-value">${Math.round((c.grass_pollen ?? 0) + (c.birch_pollen ?? 0))}</div>
                        <div class="metric-label">Total</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${((c.grass_pollen ?? 0) > 20 ? 'High' : (c.grass_pollen ?? 0) > 5 ? 'Moderate' : 'Low')}</div>
                        <div class="metric-label">Level</div>
                    </div>
                </div>
                <ul class="health-list">
                    <li>Grass: ${Math.round(c.grass_pollen ?? 0)}</li>
                    <li>Birch: ${Math.round(c.birch_pollen ?? 0)}</li>
                    <li>Ragweed: ${Math.round(c.ragweed_pollen ?? 0)}</li>
                </ul>
            </div>
        `;
    }

    renderQuickHealth(data, aq) {
        const container = document.getElementById('quickHealthCards');
        if (!container) return;

        const cur = data.current;
        const temp = cur.temperature_2m;
        const humidity = cur.relative_humidity_2m;
        const pressure = cur.pressure_msl;

        // Simplified risk calculations
        const malaria = this.malariaRisk(temp, humidity);
        const heat = this.heatRisk(temp, humidity);
        const migraine = this.migraineRisk(pressure);

        container.innerHTML = `
            ${this.riskCard('Malaria Risk', 'fa-mosquito', malaria)}
            ${this.riskCard('Heat Stress', 'fa-temperature-high', heat)}
            ${this.riskCard('Migraine Risk', 'fa-head-side-virus', migraine)}
        `;
    }

    riskCard(title, icon, risk) {
        return `
            <div class="health-card">
                <div class="health-icon" style="color:${risk.color}"><i class="fas ${icon}"></i></div>
                <h3 class="health-title">${title}</h3>
                <div style="font-size:1.8rem;font-weight:800;color:${risk.color};margin:12px 0">${risk.level}</div>
                <p style="color:var(--text-muted);font-size:0.9rem">${risk.advice}</p>
            </div>
        `;
    }

    malariaRisk(temp, humidity) {
        let score = 0;
        if (temp >= 18 && temp <= 32) score += 40;
        if (humidity > 60) score += 30;
        if (temp > 24 && humidity > 70) score += 30;
        if (score >= 70) return { level: 'High', color: '#ef4444', advice: 'Use mosquito nets and repellent.' };
        if (score >= 40) return { level: 'Moderate', color: '#f59e0b', advice: 'Take precautions at dusk.' };
        return { level: 'Low', color: '#22c55e', advice: 'Standard protection is fine.' };
    }

    heatRisk(temp, humidity) {
        const heatIndex = temp + (humidity / 100) * (temp - 14);
        if (heatIndex > 40) return { level: 'Extreme', color: '#7c2d12', advice: 'Avoid outdoor activity.' };
        if (heatIndex > 32) return { level: 'High', color: '#ef4444', advice: 'Hydrate and seek shade.' };
        if (heatIndex > 27) return { level: 'Moderate', color: '#f59e0b', advice: 'Stay hydrated.' };
        return { level: 'Low', color: '#22c55e', advice: 'Comfortable conditions.' };
    }

    migraineRisk(pressure) {
        const distFromNormal = Math.abs(pressure - 1013);
        if (distFromNormal > 15) return { level: 'High', color: '#ef4444', advice: 'Pressure swing may trigger migraines.' };
        if (distFromNormal > 8) return { level: 'Moderate', color: '#f59e0b', advice: 'Stay hydrated, avoid stress.' };
        return { level: 'Low', color: '#22c55e', advice: 'Stable conditions.' };
    }

    // ============ SCENE ============

    updateScene(data, loc) {
        if (!window.__setWeatherScene) return;
        const cur = data.current;
        const cond = weatherCodeToCondition(cur.weather_code);
        window.__setWeatherScene({
            condition: cond,
            isDay: cur.is_day === 1,
            temperature: cur.temperature_2m,
            windSpeed: cur.wind_speed_10m || 0
        });
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
