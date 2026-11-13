/**
 * EmmiDev Weather — Health Intelligence Module
 * Migraine, heat stress, wind chill, UV timer, sleep quality, hydration,
 * plus 3-day allergy forecast. No external API — uses existing weather data.
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { AppState } from '../core/state.js';
import { Bus, Events } from '../core/events.js';

const SKIN_MULTIPLIERS = {
    // Fitzpatrick skin types → MED (minimum erythema dose) multiplier
    1: 2.5,   // Very fair — burns in ~2.5 min at UV 10
    2: 3.5,
    3: 5,
    4: 7,
    5: 10,
    6: 15
};

const HYDRATION_BASE_L_PER_DAY = 2.0;
const HYDRATION_PER_DEGREE_ABOVE_25 = 0.15;

class HealthModule {
    constructor() {
        this.data = null;
        this.aq = null;
        this.skinType = 3;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        this.skinType = Number(Storage.get('emmidev::skinType', 3)) || 3;

        Bus.on(Events.WEATHER_LOADED, ({ weather, aq }) => {
            if (!weather) return;
            this.data = weather;
            this.aq = aq;
            this.renderAll();
        });

        // Also react to unit changes
        Bus.on(Events.UNITS_CHANGED, () => {
            if (this.data) this.renderAll();
        });

        // Skin type change from Settings
        const skinSelect = document.getElementById('skinTypeSelect');
        if (skinSelect) {
            skinSelect.value = String(this.skinType);
            skinSelect.addEventListener('change', () => {
                this.skinType = Number(skinSelect.value) || 3;
                Storage.set('emmidev::skinType', this.skinType);
                if (this.data) this.renderAll();
            });
        }

        // Also try to render if data already loaded
        const existing = AppState.get('currentWeather');
        if (existing) {
            this.data = existing;
            this.aq = AppState.get('airQuality');
            this.renderAll();
        }

        console.log('[Health] Ready');
    }

    /* ============================================================
       MASTER RENDER
       ============================================================ */
    renderAll() {
        if (!this.data?.current) return;
        this.renderBodyComfort();
        this.renderAllergyForecast();
    }

    /* ============================================================
       BODY COMFORT CARDS (6 cards)
       ============================================================ */
    renderBodyComfort() {
        const container = document.getElementById('bodyComfortCards');
        if (!container) return;

        const cards = [
            this.migraineCard(),
            this.heatStressCard(),
            this.windChillCard(),
            this.uvTimerCard(),
            this.sleepQualityCard(),
            this.hydrationCard()
        ].filter(Boolean);

        container.innerHTML = cards.join('');
    }

    /* ---- 1. MIGRAINE / PRESSURE HEADACHE ---- */
    migraineCard() {
        const current = this.data.current;
        const pressure = Number(current.pressure_msl);
        if (!Number.isFinite(pressure)) return null;

        // Compare to 3 hours ago using hourly data
        const now = new Date();
        const hourly = this.data.hourly;
        let pressureChange = 0;
        if (hourly?.time && hourly?.pressure_msl) {
            const nowIdx = hourly.time.findIndex(t => new Date(t) >= now);
            if (nowIdx > 3) {
                const thenPressure = Number(hourly.pressure_msl[nowIdx - 3]);
                if (Number.isFinite(thenPressure)) {
                    pressureChange = pressure - thenPressure;
                }
            }
        }

        let risk, color, advice, icon;
        const absChange = Math.abs(pressureChange);

        if (absChange >= 8) {
            risk = 'High';
            color = '#dc2626';
            icon = 'fa-head-side-virus';
            advice = `Pressure ${pressureChange < 0 ? 'dropping' : 'rising'} ${absChange.toFixed(1)} hPa — migraine risk is elevated. Stay hydrated, avoid bright screens.`;
        } else if (absChange >= 4) {
            risk = 'Moderate';
            color = '#ea580c';
            icon = 'fa-head-side-virus';
            advice = `Pressure shifting ${absChange.toFixed(1)} hPa — sensitive people may feel headaches. Take it easy.`;
        } else {
            risk = 'Low';
            color = '#16a34a';
            icon = 'fa-head-side-virus';
            advice = `Pressure steady at ${Math.round(pressure)} hPa — no headache trigger expected.`;
        }

        return this.healthCard({
            icon,
            color,
            title: 'Headache Risk',
            level: risk,
            detail: pressureChange !== 0
                ? `${pressureChange > 0 ? '+' : ''}${pressureChange.toFixed(1)} hPa (3h)`
                : `${Math.round(pressure)} hPa`,
            advice
        });
    }

    /* ---- 2. HEAT STRESS ---- */
    heatStressCard() {
        const current = this.data.current;
        const imperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        let feels = Number(current.apparent_temperature);
        if (imperial) feels = (feels - 32) * 5 / 9;

        let level, color, advice;
        if (feels >= 40) {
            level = 'Extreme'; color = '#7f1d1d';
            advice = 'Dangerous heat. Avoid going outside. Drink water every 15 minutes.';
        } else if (feels >= 35) {
            level = 'High'; color = '#dc2626';
            advice = 'Heat exhaustion risk. Limit outdoor work to early morning or evening.';
        } else if (feels >= 30) {
            level = 'Moderate'; color = '#ea580c';
            advice = 'Take water breaks every 30 minutes if working outside.';
        } else if (feels >= 25) {
            level = 'Warm'; color = '#ca8a04';
            advice = 'Comfortable for most activity. Stay hydrated.';
        } else if (feels <= 5) {
            level = 'Cold stress'; color = '#1e40af';
            advice = 'Wear layers. Risk of hypothermia if exposed for extended periods.';
        } else {
            level = 'Comfortable'; color = '#16a34a';
            advice = 'No heat or cold stress — good conditions for outdoor activity.';
        }

        return this.healthCard({
            icon: 'fa-temperature-high',
            color,
            title: 'Heat Stress',
            level,
            detail: `Feels like ${this.formatTemp(feels)}`,
            advice
        });
    }

    /* ---- 3. WIND CHILL ---- */
    windChillCard() {
        const current = this.data.current;
        const temp = Number(current.temperature_2m);
        const wind = Number(current.wind_speed_10m) || 0;
        const imperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';

        // Only show wind chill when cold + windy
        if (temp > 15 || wind < 10) {
            // Show something useful instead
            return this.healthCard({
                icon: 'fa-wind',
                color: '#64748b',
                title: 'Wind Chill',
                level: 'Not applicable',
                detail: `Temp ${this.formatTemp(temp)} · Wind ${Math.round(wind)} km/h`,
                advice: 'Wind chill only applies when temperature is below 15°C and wind is above 10 km/h.'
            });
        }

        // Standard wind chill formula (metric)
        const tempC = imperial ? (temp - 32) * 5 / 9 : temp;
        const windKmh = imperial ? wind * 1.60934 : wind;
        const chill = 13.12 + 0.6215 * tempC
                    - 11.37 * Math.pow(windKmh, 0.16)
                    + 0.3965 * tempC * Math.pow(windKmh, 0.16);

        let level, color, advice;
        if (chill <= -20) {
            level = 'Severe'; color = '#7f1d1d';
            advice = 'Frostbite possible in under 30 minutes. Cover all exposed skin.';
        } else if (chill <= -10) {
            level = 'High'; color = '#dc2626';
            advice = 'Frostbite risk on exposed skin. Wear gloves, hat, and warm layers.';
        } else if (chill <= 0) {
            level = 'Moderate'; color = '#ea580c';
            advice = 'Bitter cold. Wear a heavy coat, hat, and gloves.';
        } else {
            level = 'Low'; color = '#16a34a';
            advice = 'Bundle up — wind makes it feel colder than the thermometer says.';
        }

        const displayChill = imperial ? (chill * 9 / 5) + 32 : chill;

        return this.healthCard({
            icon: 'fa-wind',
            color,
            title: 'Wind Chill',
            level,
            detail: `Feels like ${this.formatTemp(displayChill)}`,
            advice
        });
    }

    /* ---- 4. UV EXPOSURE TIMER ---- */
    uvTimerCard() {
        const current = this.data.current;
        const daily = this.data.daily;
        const aqCurrent = this.aq?.current;

        // Use live UV if available, else daily max
        let uv = aqCurrent?.uv_index;
        if (!Number.isFinite(uv)) {
            uv = daily?.uv_index_max?.[0];
        }
        if (!Number.isFinite(uv)) {
            return this.healthCard({
                icon: 'fa-sun',
                color: '#64748b',
                title: 'UV Exposure',
                level: 'Unavailable',
                detail: '—',
                advice: 'UV data is not available for this location right now.'
            });
        }

        const multiplier = SKIN_MULTIPLIERS[this.skinType] || 5;
        // Safe sun time (minutes) before burning
        const safeMinutes = uv > 0 ? Math.round((200 / uv) * (multiplier / 5)) : 120;

        let level, color, advice;
        if (uv >= 11) {
            level = 'Extreme'; color = '#7c2d12';
            advice = 'Avoid direct sun. Apply SPF 50+ if you must go out.';
        } else if (uv >= 8) {
            level = 'Very High'; color = '#dc2626';
            advice = 'Sunburn in minutes. Use sunscreen, hat, sunglasses, and shade.';
        } else if (uv >= 6) {
            level = 'High'; color = '#ea580c';
            advice = 'Sun protection needed — sunscreen, hat, and shade.';
        } else if (uv >= 3) {
            level = 'Moderate'; color = '#ca8a04';
            advice = 'Consider sun protection if outside for extended periods.';
        } else {
            level = 'Low'; color = '#16a34a';
            advice = 'Safe to be outside without extra protection.';
        }

        const detail = safeMinutes < 15
            ? `Burn in ~${safeMinutes} min`
            : safeMinutes < 60
                ? `Safe for ~${safeMinutes} min`
                : `Safe for 1-2 hours`;

        return this.healthCard({
            icon: 'fa-sun',
            color,
            title: 'UV Exposure',
            level,
            detail: `UV ${uv.toFixed(1)} · ${detail}`,
            advice
        });
    }

    /* ---- 5. SLEEP QUALITY FORECAST ---- */
    sleepQualityCard() {
        const hourly = this.data.hourly;
        if (!hourly?.time) return null;

        // Find tonight's sleep window (22:00 → 06:00 next day)
        const now = new Date();
        const tonight = new Date(now);
        tonight.setHours(22, 0, 0, 0);
        if (tonight.getTime() < now.getTime()) {
            tonight.setDate(tonight.getDate() + 1);
        }
        const morning = new Date(tonight);
        morning.setHours(6, 0, 0, 0);
        morning.setDate(morning.getDate() + 1);

        const sleepHours = [];
        hourly.time.forEach((t, idx) => {
            const d = new Date(t);
            if (d >= tonight && d <= morning) {
                sleepHours.push({
                    time: t,
                    temp: Number(hourly.temperature_2m?.[idx]),
                    humidity: Number(hourly.relative_humidity_2m?.[idx]),
                    apparent: Number(hourly.apparent_temperature?.[idx])
                });
            }
        });

        if (sleepHours.length === 0) {
            return this.healthCard({
                icon: 'fa-moon',
                color: '#64748b',
                title: 'Sleep Quality',
                level: 'Unavailable',
                detail: '—',
                advice: 'Tonight\'s hourly forecast is not available yet.'
            });
        }

        const avgTemp = sleepHours.reduce((s, h) => s + h.apparent, 0) / sleepHours.length;
        const avgHumidity = sleepHours.reduce((s, h) => s + h.humidity, 0) / sleepHours.length;

        let level, color, advice;
        const tempF = avgTemp * 9 / 5 + 32;
        const ideal = avgTemp >= 16 && avgTemp <= 21 && avgHumidity >= 40 && avgHumidity <= 60;

        if (ideal) {
            level = 'Excellent'; color = '#16a34a';
            advice = 'Ideal sleeping conditions tonight. Open a window for fresh air.';
        } else if (avgTemp > 26) {
            level = 'Too warm'; color = '#ea580c';
            advice = 'Room will be warm — use a fan, light sheets, and hydrate before bed.';
        } else if (avgTemp > 21) {
            level = 'Warm'; color = '#ca8a04';
            advice = 'Slightly warm for sleep. Use light bedding and keep a window open.';
        } else if (avgTemp < 14) {
            level = 'Too cold'; color = '#1e40af';
            advice = 'Cold night ahead — use extra blankets and warm socks.';
        } else if (avgHumidity > 70) {
            level = 'Humid'; color = '#0891b2';
            advice = 'Humid night — use a dehumidifier or AC if available.';
        } else if (avgHumidity < 30) {
            level = 'Dry air'; color = '#a16207';
            advice = 'Dry air may irritate throat and nose. Consider a humidifier.';
        } else {
            level = 'Fair'; color = '#16a34a';
            advice = 'Comfortable sleeping conditions tonight.';
        }

        return this.healthCard({
            icon: 'fa-moon',
            color,
            title: 'Sleep Quality',
            level,
            detail: `${this.formatTemp(avgTemp)} · ${Math.round(avgHumidity)}% humidity`,
            advice
        });
    }

    /* ---- 6. HYDRATION REMINDER ---- */
    hydrationCard() {
        const current = this.data.current;
        const imperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        let temp = Number(current.apparent_temperature);
        if (imperial) temp = (temp - 32) * 5 / 9;

        // Base 2L + 0.15L per degree above 25°C
        const extra = Math.max(0, temp - 25) * HYDRATION_PER_DEGREE_ABOVE_25;
        const liters = HYDRATION_BASE_L_PER_DAY + extra;

        let level, color, advice;
        if (temp >= 35) {
            level = 'High need'; color = '#dc2626';
            advice = `Drink ${liters.toFixed(1)}L today. Add electrolytes if sweating heavily.`;
        } else if (temp >= 28) {
            level = 'Elevated'; color = '#ea580c';
            advice = `Drink ${liters.toFixed(1)}L today. Avoid sugary drinks — water is best.`;
        } else if (temp >= 20) {
            level = 'Normal'; color = '#16a34a';
            advice = `Drink about ${liters.toFixed(1)}L today. Add more if you exercise.`;
        } else {
            level = 'Normal'; color = '#16a34a';
            advice = `Drink about ${liters.toFixed(1)}L today. Warm fluids are fine in cool weather.`;
        }

        return this.healthCard({
            icon: 'fa-droplet',
            color,
            title: 'Hydration',
            level,
            detail: `~${liters.toFixed(1)} L target`,
            advice
        });
    }

    /* ============================================================
       ALLERGY FORECAST (3-day pollen trend)
       ============================================================ */
    renderAllergyForecast() {
        const container = document.getElementById('allergyForecast');
        if (!container) return;

        const aq = this.aq?.current;
        if (!aq) {
            container.innerHTML = `
                <div class="allergy-card">
                    <h4>Pollen data unavailable</h4>
                    <p class="section-note">Allergy forecast requires air-quality data.</p>
                </div>
            `;
            return;
        }

        // Pollen readings from Open-Meteo AQ (current only)
        const pollenTypes = [
            { key: 'grass_pollen', label: 'Grass', icon: 'fa-seedling' },
            { key: 'birch_pollen', label: 'Birch', icon: 'fa-tree' },
            { key: 'ragweed_pollen', label: 'Ragweed', icon: 'fa-leaf' },
            { key: 'olive_pollen', label: 'Olive', icon: 'fa-tree' },
            { key: 'alder_pollen', label: 'Alder', icon: 'fa-tree' },
            { key: 'mugwort_pollen', label: 'Mugwort', icon: 'fa-seedling' }
        ];

        const available = pollenTypes
            .map(p => ({ ...p, value: Number(aq[p.key]) }))
            .filter(p => Number.isFinite(p.value) && p.value >= 0);

        if (available.length === 0) {
            container.innerHTML = `
                <div class="allergy-card">
                    <h4>No pollen data</h4>
                    <p class="section-note">Pollen readings are not reported for this location.</p>
                </div>
            `;
            return;
        }

        // Build 3-day trend: use today's value + simulate tomorrow/day-3 using
        // weather (rain reduces pollen, wind increases it)
        const tomorrowMod = this.pollenForecastModifier(1);
        const day3Mod = this.pollenForecastModifier(2);

        container.innerHTML = available.map(p => {
            const today = p.value;
            const tomorrow = Math.max(0, today * tomorrowMod);
            const day3 = Math.max(0, tomorrow * day3Mod);
            const trend = day3 > today * 1.15 ? 'rising'
                        : day3 < today * 0.85 ? 'falling'
                        : 'stable';
            const trendIcon = trend === 'rising' ? 'fa-arrow-trend-up'
                            : trend === 'falling' ? 'fa-arrow-trend-down'
                            : 'fa-minus';

            const maxVal = Math.max(today, tomorrow, day3, 1);
            const bar = (v) => Math.max(4, (v / maxVal) * 100);

            const levelLabel = today >= 50 ? 'High' : today >= 20 ? 'Moderate' : today > 0 ? 'Low' : 'None';
            const levelColor = today >= 50 ? '#dc2626' : today >= 20 ? '#ea580c' : today > 0 ? '#16a34a' : '#64748b';

            return `
                <div class="allergy-card">
                    <h4>
                        <i class="fas ${p.icon}" aria-hidden="true"></i>
                        ${p.label}
                        <span style="float:right;color:${levelColor};font-size:0.8rem">${levelLabel}</span>
                    </h4>
                    <div class="allergy-trend is-${trend}">
                        <i class="fas ${trendIcon}" aria-hidden="true"></i>
                        <span>${today.toFixed(0)} grains/m³ · ${trend} trend</span>
                    </div>
                    <div class="allergy-spark" role="img" aria-label="3-day trend">
                        <span style="height:${bar(today)}%" title="Today"></span>
                        <span style="height:${bar(tomorrow)}%" title="Tomorrow"></span>
                        <span style="height:${bar(day3)}%" title="Day 3"></span>
                    </div>
                </div>
            `;
        }).join('');
    }

    pollenForecastModifier(dayOffset) {
        // Rough forecast: rain reduces pollen, wind increases it
        if (!this.data?.daily) return 1;
        const daily = this.data.daily;
        const rain = Number(daily.precipitation_sum?.[dayOffset]) || 0;
        const wind = Number(daily.wind_speed_10m_max?.[dayOffset]) || 0;

        let mod = 1;
        if (rain > 5) mod -= 0.4;
        else if (rain > 1) mod -= 0.2;
        if (wind > 25) mod += 0.2;
        else if (wind > 15) mod += 0.1;
        return Math.max(0.2, mod);
    }

    /* ============================================================
       HELPERS
       ============================================================ */
    healthCard({ icon, color, title, level, detail, advice }) {
        return `
            <article class="health-card body-comfort-card">
                <div class="health-icon" style="color:${color}">
                    <i class="fas ${icon}" aria-hidden="true"></i>
                </div>
                <h3 class="health-title">${title}</h3>
                <div class="body-comfort-level" style="color:${color}">${level}</div>
                <div class="body-comfort-detail">${detail}</div>
                <p class="body-comfort-advice">${advice}</p>
            </article>
        `;
    }

    formatTemp(celsius) {
        const imperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        if (imperial) {
            const f = (celsius * 9 / 5) + 32;
            return `${Math.round(f)}°F`;
        }
        return `${Math.round(celsius)}°C`;
    }
}

export const Health = new HealthModule();