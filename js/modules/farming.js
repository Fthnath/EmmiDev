/**
 * EmmiDev Weather — Farming Intelligence Module
 * Spray windows, frost risk, irrigation advice, livestock heat stress,
 * rainfall accumulation chart. No external API — uses existing weather data.
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { AppState } from '../core/state.js';
import { Bus, Events } from '../core/events.js';
import { formatWind } from '../utils/format.js';

// Crop profiles with ideal conditions
const CROP_PROFILES = {
    maize: {
        name: 'Maize',
        minTemp: 18, maxTemp: 32,
        frostSensitive: true,
        sprayWindMax: 15,
        plantingMonths: [2, 3, 7, 8]
    },
    beans: {
        name: 'Beans',
        minTemp: 16, maxTemp: 28,
        frostSensitive: true,
        sprayWindMax: 12,
        plantingMonths: [2, 3, 7, 8]
    },
    cassava: {
        name: 'Cassava',
        minTemp: 20, maxTemp: 32,
        frostSensitive: false,
        sprayWindMax: 18,
        plantingMonths: [1, 2, 7, 8, 9]
    },
    groundnuts: {
        name: 'Groundnuts',
        minTemp: 20, maxTemp: 32,
        frostSensitive: true,
        sprayWindMax: 14,
        plantingMonths: [2, 3, 7, 8]
    },
    rice: {
        name: 'Rice',
        minTemp: 20, maxTemp: 35,
        frostSensitive: false,
        sprayWindMax: 16,
        plantingMonths: [2, 3, 8, 9]
    },
    coffee: {
        name: 'Coffee',
        minTemp: 18, maxTemp: 30,
        frostSensitive: true,
        sprayWindMax: 12,
        plantingMonths: [2, 3, 7, 8]
    }
};

class FarmingModule {
    constructor() {
        this.data = null;
        this.chart = null;
        this.selectedCrop = 'maize';
    }

    init() {
        this.selectedCrop = this.readCrop();

        // Crop selector
        const select = document.getElementById('farmCropSelect');
        if (select) {
            select.value = this.selectedCrop;
            select.addEventListener('change', () => {
                this.selectedCrop = select.value;
                Storage.set(CONFIG.STORAGE_KEYS.FARM_PROFILE, { crop: this.selectedCrop });
                if (this.data) this.renderAll();
            });
        }

        // React to weather
        Bus.on(Events.WEATHER_LOADED, ({ weather }) => {
            if (!weather) return;
            this.data = weather;
            this.renderAll();
        });

        // React to unit changes
        Bus.on(Events.UNITS_CHANGED, () => {
            if (this.data) this.renderAll();
        });

        // Render from cache if available
        const cached = AppState.get('currentWeather');
        if (cached) {
            this.data = cached;
            this.renderAll();
        }

        // Handle resize for chart
        window.addEventListener('resize', () => this.chart?.resize());

        console.log('[Farming] Ready');
    }

    readCrop() {
        const profile = Storage.get(CONFIG.STORAGE_KEYS.FARM_PROFILE, {});
        const crop = typeof profile === 'string' ? profile : profile?.crop;
        return CROP_PROFILES[crop] ? crop : 'maize';
    }

    /* ============================================================
       MASTER RENDER
       ============================================================ */
    renderAll() {
        if (!this.data?.current) return;
        this.renderFarmActions();
        this.renderRainAccumulationChart();
        this.renderLegacyAdvisor();
    }

    /* ============================================================
       FARM ACTIONS (4 cards)
       ============================================================ */
    renderFarmActions() {
        const container = document.getElementById('farmActions');
        if (!container) return;

        const crop = CROP_PROFILES[this.selectedCrop];
        const cards = [
            this.sprayWindowCard(crop),
            this.frostRiskCard(crop),
            this.irrigationCard(crop),
            this.livestockCard(),
            this.harvestWindowCard(crop),
            this.growingDegreeCard(crop)
        ].filter(Boolean);

        container.innerHTML = cards.join('');
    }

    /* ---- 1. SPRAY WINDOW ---- */
    sprayWindowCard(crop) {
        const hourly = this.data.hourly;
        if (!hourly?.time) return null;

        const now = new Date();
        const windows = [];
        const windUnit = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
        const isImperial = windUnit === 'imperial';

        // Scan next 24 hours for good spray windows
        for (let i = 0; i < hourly.time.length && i < 24; i++) {
            const t = new Date(hourly.time[i]);
            if (t < now) continue;

            const wind = Number(hourly.wind_speed_10m?.[i]);
            const gust = Number(hourly.wind_gusts_10m?.[i]) || wind;
            const precipProb = Number(hourly.precipitation_probability?.[i]) || 0;
            const precip = Number(hourly.precipitation?.[i]) || 0;
            const temp = Number(hourly.temperature_2m?.[i]);

            // Good spray conditions: low wind, no rain, moderate temp
            const windOk = wind < crop.sprayWindMax;
            const gustOk = gust < crop.sprayWindMax * 1.5;
            const rainOk = precipProb < 20 && precip < 0.1;
            const tempOk = temp >= 10 && temp <= 30;

            if (windOk && gustOk && rainOk && tempOk) {
                windows.push({ time: t, wind, gust });
            }

            if (windows.length >= 6) break;
        }

        // Group consecutive hours
        const groups = this.groupConsecutive(windows);

        let status, statusClass, icon, advice, times;

        if (groups.length === 0) {
            status = 'Not safe';
            statusClass = 'status-danger';
            icon = 'fa-ban';
            advice = `Wind or rain conditions are not suitable for spraying ${crop.name} in the next 24 hours.`;
            times = 'No suitable window';
        } else {
            const best = groups[0];
            status = 'Safe to spray';
            statusClass = 'status-ok';
            icon = 'fa-spray-can';
            const startStr = this.formatTime(best.start);
            const endStr = this.formatTime(best.end);
            times = `${startStr} – ${endStr}`;
            advice = `Wind below ${isImperial ? Math.round(crop.sprayWindMax / 1.609) : crop.sprayWindMax} ${isImperial ? 'mph' : 'km/h'}, no rain expected. Best conditions for ${crop.name}.`;
            if (groups.length > 1) {
                advice += ` ${groups.length - 1} more window${groups.length > 2 ? 's' : ''} later.`;
            }
        }

        return this.actionCard({
            icon,
            status,
            statusClass,
            title: 'Spray Window',
            detail: times,
            advice
        });
    }

    /* ---- 2. FROST RISK ---- */
    frostRiskCard(crop) {
        const daily = this.data.daily;
        if (!daily?.time) return null;

        const isImperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        const lows = (daily.temperature_2m_min || []).slice(0, 3).map(v => Number(v));
        const minLow = Math.min(...lows.filter(Number.isFinite));

        if (!Number.isFinite(minLow)) return null;

        const minLowC = isImperial ? (minLow - 32) * 5 / 9 : minLow;
        const displayTemp = isImperial ? `${Math.round(minLow)}°F` : `${Math.round(minLow)}°C`;

        let status, statusClass, icon, advice;

        if (!crop.frostSensitive) {
            status = 'Not sensitive';
            statusClass = 'status-ok';
            icon = 'fa-leaf';
            advice = `${crop.name} tolerates cold better than most crops. Frost risk is low priority.`;
        } else if (minLowC <= 0) {
            status = 'Severe risk';
            statusClass = 'status-danger';
            icon = 'fa-snowflake';
            advice = `Frost expected (${displayTemp}). Cover young ${crop.name} plants or harvest what you can.`;
        } else if (minLowC <= 4) {
            status = 'Frost risk';
            statusClass = 'status-warn';
            icon = 'fa-snowflake';
            advice = `Near-frost temperatures (${displayTemp}). Monitor ${crop.name} overnight.`;
        } else if (minLowC <= 8) {
            status = 'Cool nights';
            statusClass = 'status-warn';
            icon = 'fa-temperature-low';
            advice = `Nights will be cool (${displayTemp}). ${crop.name} growth may slow.`;
        } else {
            status = 'No frost';
            statusClass = 'status-ok';
            icon = 'fa-sun';
            advice = `Overnight lows of ${displayTemp} are safe for ${crop.name}.`;
        }

        return this.actionCard({
            icon,
            status,
            statusClass,
            title: 'Frost Risk',
            detail: `3-day low: ${displayTemp}`,
            advice
        });
    }

    /* ---- 3. IRRIGATION ---- */
    irrigationCard(crop) {
        const daily = this.data.daily;
        if (!daily?.time) return null;

        const next3Days = (daily.precipitation_sum || []).slice(0, 3).map(v => Number(v) || 0);
        const totalRain = next3Days.reduce((s, v) => s + v, 0);

        const isImperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        const displayRain = isImperial
            ? `${(totalRain / 25.4).toFixed(2)} in`
            : `${totalRain.toFixed(1)} mm`;

        let status, statusClass, icon, advice;

        if (totalRain >= 20) {
            status = 'Skip irrigation';
            statusClass = 'status-ok';
            icon = 'fa-cloud-showers-heavy';
            advice = `Heavy rain coming (${displayRain}). Hold off on watering ${crop.name}.`;
        } else if (totalRain >= 8) {
            status = 'Light irrigation';
            statusClass = 'status-ok';
            icon = 'fa-cloud-rain';
            advice = `Some rain expected (${displayRain}). Reduce ${crop.name} watering accordingly.`;
        } else if (totalRain >= 2) {
            status = 'Supplement';
            statusClass = 'status-warn';
            icon = 'fa-droplet';
            advice = `Little rain expected (${displayRain}). Supplement ${crop.name} with irrigation.`;
        } else {
            status = 'Irrigate';
            statusClass = 'status-warn';
            icon = 'fa-droplet';
            advice = `No rain expected (${displayRain}). Irrigate ${crop.name} this week.`;
        }

        return this.actionCard({
            icon,
            status,
            statusClass,
            title: 'Irrigation',
            detail: `3-day rain: ${displayRain}`,
            advice
        });
    }

    /* ---- 4. LIVESTOCK HEAT STRESS ---- */
    livestockCard() {
        const current = this.data.current;
        if (!current) return null;

        const isImperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        let feels = Number(current.apparent_temperature);
        if (isImperial) feels = (feels - 32) * 5 / 9;

        const humidity = Number(current.relative_humidity_2m) || 0;

        // Temperature-Humidity Index for livestock
        const tempF = feels * 9 / 5 + 32;
        const thi = (1.8 * tempF + 32) - (0.55 - 0.0055 * humidity) * (1.8 * tempF - 26);

        const displayFeels = isImperial
            ? `${Math.round(feels * 9 / 5 + 32)}°F`
            : `${Math.round(feels)}°C`;

        let status, statusClass, icon, advice;

        if (thi >= 88) {
            status = 'Severe stress';
            statusClass = 'status-danger';
            icon = 'fa-cow';
            advice = 'Dangerous heat for livestock. Provide shade, extra water, and misting if possible. Avoid moving animals.';
        } else if (thi >= 79) {
            status = 'High stress';
            statusClass = 'status-warn';
            icon = 'fa-cow';
            advice = 'Heat stress likely. Give extra water, shade, and avoid midday handling.';
        } else if (thi >= 72) {
            status = 'Mild stress';
            statusClass = 'status-warn';
            icon = 'fa-cow';
            advice = 'Mild heat stress. Monitor water intake and provide shade.';
        } else {
            status = 'Comfortable';
            statusClass = 'status-ok';
            icon = 'fa-cow';
            advice = 'THI within comfort zone — livestock are fine with normal care.';
        }

        return this.actionCard({
            icon,
            status,
            statusClass,
            title: 'Livestock Stress',
            detail: `THI ${Math.round(thi)} · ${displayFeels}`,
            advice
        });
    }

    /* ---- 5. HARVEST WINDOW ---- */
    harvestWindowCard(crop) {
        const daily = this.data.daily;
        if (!daily?.time) return null;

        // Find next 3 dry days (for harvest/drying)
        let dryDays = 0;
        let startDay = null;
        for (let i = 0; i < daily.time.length; i++) {
            const rain = Number(daily.precipitation_sum?.[i]) || 0;
            if (rain < 1) {
                if (!startDay) startDay = new Date(daily.time[i]);
                dryDays++;
                if (dryDays >= 3) break;
            } else {
                dryDays = 0;
                startDay = null;
            }
        }

        let status, statusClass, icon, advice, detail;

        if (dryDays >= 3 && startDay) {
            status = 'Good window';
            statusClass = 'status-ok';
            icon = 'fa-wheat-awn';
            detail = `${dryDays} dry days ahead`;
            advice = `Good conditions for harvesting or drying ${crop.name} starting ${startDay.toLocaleDateString(undefined, { weekday: 'short' })}.`;
        } else if (dryDays >= 1) {
            status = 'Short window';
            statusClass = 'status-warn';
            icon = 'fa-wheat-awn';
            detail = `${dryDays} dry day${dryDays > 1 ? 's' : ''}`;
            advice = `Brief dry period — harvest ${crop.name} quickly if mature.`;
        } else {
            status = 'Wait';
            statusClass = 'status-danger';
            icon = 'fa-cloud-rain';
            detail = 'Rain expected';
            advice = `Rain ahead — postpone ${crop.name} harvest until conditions dry.`;
        }

        return this.actionCard({
            icon,
            status,
            statusClass,
            title: 'Harvest Window',
            detail,
            advice
        });
    }

    /* ---- 6. GROWING DEGREE DAYS ---- */
    growingDegreeCard(crop) {
        const daily = this.data.daily;
        if (!daily?.temperature_2m_max) return null;

        // GDD = max(0, (Tmax + Tmin)/2 - Tbase)
        const tbase = 10;
        const isImperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        let gdd = 0;

        for (let i = 0; i < Math.min(10, daily.temperature_2m_max.length); i++) {
            let tmax = Number(daily.temperature_2m_max[i]);
            let tmin = Number(daily.temperature_2m_min[i]);
            if (isImperial) {
                tmax = (tmax - 32) * 5 / 9;
                tmin = (tmin - 32) * 5 / 9;
            }
            const avg = (tmax + tmin) / 2;
            gdd += Math.max(0, avg - tbase);
        }

        // Determine growth stage based on accumulated GDD for maize
        let stage, advice;
        const totalGdd = gdd;

        if (totalGdd < 100) {
            stage = 'Early growth';
            advice = `Heat accumulation is slow. ${crop.name} growth may be delayed.`;
        } else if (totalGdd < 400) {
            stage = 'Vegetative';
            advice = `Vegetative stage. Ensure adequate moisture and nutrients.`;
        } else if (totalGdd < 800) {
            stage = 'Tasseling';
            advice = `Tasseling stage. Critical water needs — do not stress plants.`;
        } else if (totalGdd < 1200) {
            stage = 'Grain fill';
            advice = `Grain fill stage. Maintain water and watch for pests.`;
        } else {
            stage = 'Maturing';
            advice = `Approaching maturity. Plan harvest window.`;
        }

        return this.actionCard({
            icon: 'fa-seedling',
            status: stage,
            statusClass: 'status-ok',
            title: 'Growing Degree',
            detail: `${Math.round(gdd)} GDD (10-day)`,
            advice
        });
    }

    /* ============================================================
       RAINFALL ACCUMULATION CHART (7/14/30 day)
       ============================================================ */
    renderRainAccumulationChart() {
        const canvas = document.getElementById('rainAccumulationChart');
        if (!canvas || !window.Chart) return;

        const daily = this.data.daily;
        if (!daily?.time) return;

        const isImperial = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial';
        const precip = (daily.precipitation_sum || []).map(v => Number(v) || 0);
        const labels = daily.time.map(d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const unit = isImperial ? 'in' : 'mm';
        const converted = isImperial ? precip.map(v => v / 25.4) : precip;

        // Cumulative
        let cum = 0;
        const cumulative = converted.map(v => { cum += v; return cum; });

        if (this.chart) this.chart.destroy();

        this.chart = new window.Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        type: 'bar',
                        label: `Daily rain (${unit})`,
                        data: converted,
                        backgroundColor: 'rgba(37, 99, 235, 0.55)',
                        borderColor: '#2563eb',
                        borderWidth: 1,
                        borderRadius: 4,
                        yAxisID: 'daily'
                    },
                    {
                        type: 'line',
                        label: `Cumulative (${unit})`,
                        data: cumulative,
                        borderColor: '#16a34a',
                        backgroundColor: 'rgba(22, 163, 74, 0.15)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 3,
                        pointBackgroundColor: '#16a34a',
                        yAxisID: 'cumulative'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const v = Number(ctx.raw || 0);
                                return `${ctx.dataset.label}: ${v.toFixed(1)} ${unit}`;
                            }
                        }
                    }
                },
                scales: {
                    daily: {
                        type: 'linear',
                        position: 'left',
                        beginAtZero: true,
                        title: { display: true, text: `Daily (${unit})` }
                    },
                    cumulative: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: `Cumulative (${unit})` }
                    }
                }
            }
        });
    }

    /* ============================================================
       LEGACY ADVISOR (keeps existing farmAdvisor working)
       ============================================================ */
    renderLegacyAdvisor() {
        const advisor = document.getElementById('farmAdvisor');
        if (!advisor) return;

        // Weather module already renders this; only fill if empty
        if (advisor.innerHTML.trim().length > 0) return;

        const crop = CROP_PROFILES[this.selectedCrop];
        advisor.innerHTML = `
            <article class="health-card">
                <h3 class="health-title">${crop.name} — Overview</h3>
                <p>Crop profile loaded. Check the action cards above for today's farming decisions.</p>
            </article>
        `;
    }

    /* ============================================================
       HELPERS
       ============================================================ */
    actionCard({ icon, status, statusClass, title, detail, advice }) {
        return `
            <article class="farm-action-card">
                <div class="farm-action-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
                <h4>${title}</h4>
                <span class="farm-action-status ${statusClass}">${status}</span>
                <p style="font-weight:600;color:var(--text);margin-bottom:6px">${detail}</p>
                <p>${advice}</p>
            </article>
        `;
    }

    groupConsecutive(windows) {
        if (windows.length === 0) return [];
        const groups = [];
        let current = [windows[0]];

        for (let i = 1; i < windows.length; i++) {
            const prev = current[current.length - 1].time;
            const curr = windows[i].time;
            const gapMin = (curr - prev) / 60000;
            if (gapMin <= 90) { // within 1.5 hours → same group
                current.push(windows[i]);
            } else {
                groups.push(current);
                current = [windows[i]];
            }
        }
        groups.push(current);

        return groups.map(g => ({
            start: g[0].time,
            end: new Date(g[g.length - 1].time.getTime() + 60 * 60 * 1000)
        }));
    }

    formatTime(date) {
        return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
}

export const Farming = new FarmingModule();