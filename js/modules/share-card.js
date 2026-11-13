/**
 * EmmiDev Weather — Share Card Generator
 * Renders current weather to a beautiful PNG for social sharing.
 * Pure Canvas — no external libraries.
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { AppState } from '../core/state.js';
import { Toast } from '../ui/toast.js';
import { formatLocationLabel } from './locations.js';

class ShareCardModule {
    constructor() {
        this.canvas = null;
        this.ctx = null;
    }

    init() {
        this.bindUI();
        console.log('[ShareCard] Ready');
    }

    bindUI() {
        // Hero share button
        const heroBtn = document.getElementById('heroShareBtn');
        if (heroBtn) {
            heroBtn.addEventListener('click', () => this.share());
        }

        // Optional: share from current weather card via long-press or dedicated button
        const cardBtn = document.getElementById('shareCardBtn');
        if (cardBtn) {
            cardBtn.addEventListener('click', () => this.share());
        }
    }

    /* ============================================================
       MAIN ENTRY — generate, then share or download
       ============================================================ */
    async share() {
        const weather = AppState.get('currentWeather');
        const loc = AppState.get('activeLocation') || this.getActiveLocation();
        const aq = AppState.get('airQuality');

        if (!weather?.current || !loc) {
            Toast.info('Weather data not ready yet');
            return;
        }

        try {
            Toast.info('Generating share card…', 1500);
            const blob = await this.generateBlob({ weather, loc, aq });
            const filename = `emmidev-weather-${loc.name.toLowerCase().replace(/\s+/g, '-')}.png`;

            // Prefer Web Share API
            if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] })) {
                const file = new File([blob], filename, { type: 'image/png' });
                try {
                    await navigator.share({
                        files: [file],
                        title: 'EmmiDev Weather',
                        text: `${loc.name}: ${Math.round(weather.current.temperature_2m)}°C — from EmmiDev Weather`
                    });
                    return;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.warn('[ShareCard] Web Share failed, falling back to download:', err);
                }
            }

            // Fallback: download
            this.download(blob, filename);
            Toast.success('Share card saved to downloads');
        } catch (err) {
            console.error('[ShareCard] Generation failed:', err);
            Toast.error('Could not create share card');
        }
    }

    getActiveLocation() {
        try {
            return AppState.get('activeLocation');
        } catch {
            return null;
        }
    }

    /* ============================================================
       GENERATE PNG BLOB
       ============================================================ */
    async generateBlob({ weather, loc, aq }) {
        const W = 1080;
        const H = 1920;
        const dpr = 1; // Export at exact 1080×1920 (Instagram story size)

        const canvas = document.createElement('canvas');
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        await this.drawBackground(ctx, W, H, weather);
        await this.drawHeader(ctx, W, loc);
        await this.drawMainTemp(ctx, W, weather);
        await this.drawCondition(ctx, W, weather);
        await this.drawStats(ctx, W, weather);
        await this.drawAdvice(ctx, W, weather, loc);
        await this.drawFooter(ctx, W, H);

        // Convert to blob
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas toBlob returned null'));
            }, 'image/png', 0.95);
        });
    }

    /* ============================================================
       DRAW: BACKGROUND (gradient + weather scene)
       ============================================================ */
    async drawBackground(ctx, W, H, weather) {
        const cond = this.detectCondition(weather.current);
        const isDay = weather.current.is_day === 1;
        const theme = this.backgroundTheme(cond, isDay);

        // Base gradient
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, theme.top);
        grad.addColorStop(0.5, theme.mid);
        grad.addColorStop(1, theme.bottom);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Sun/moon glow
        const cx = W * 0.75;
        const cy = H * 0.18;
        const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.6);
        glowGrad.addColorStop(0, theme.glow);
        glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glowGrad;
        ctx.fillRect(0, 0, W, H);

        // Rain particles
        if (cond === 'rain' || cond === 'thunderstorm') {
            this.drawRainParticles(ctx, W, H, 200);
        } else if (cond === 'snow') {
            this.drawSnowParticles(ctx, W, H, 150);
        } else if (cond === 'clouds') {
            this.drawCloudParticles(ctx, W, H);
        } else if (isDay) {
            this.drawSparkles(ctx, W, H, 60);
        }

        // Bottom darkening for text readability
        const darkGrad = ctx.createLinearGradient(0, H * 0.7, 0, H);
        darkGrad.addColorStop(0, 'rgba(0,0,0,0)');
        darkGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = darkGrad;
        ctx.fillRect(0, 0, W, H);
    }

    backgroundTheme(cond, isDay) {
        if (!isDay) {
            return {
                top: '#0a1128',
                mid: '#1a2a52',
                bottom: '#050814',
                glow: 'rgba(180, 200, 255, 0.25)'
            };
        }
        if (cond === 'rain' || cond === 'thunderstorm') {
            return {
                top: '#1e3a5f',
                mid: '#2d4a6e',
                bottom: '#0f1e33',
                glow: 'rgba(200, 220, 255, 0.15)'
            };
        }
        if (cond === 'snow') {
            return {
                top: '#c8d8eb',
                mid: '#a0b4cc',
                bottom: '#4a5a70',
                glow: 'rgba(255, 255, 255, 0.4)'
            };
        }
        if (cond === 'clouds') {
            return {
                top: '#7a8fa8',
                mid: '#a0b0c0',
                bottom: '#4a5568',
                glow: 'rgba(255, 230, 200, 0.2)'
            };
        }
        if (cond === 'fog') {
            return {
                top: '#9ca3af',
                mid: '#6b7280',
                bottom: '#374151',
                glow: 'rgba(255, 255, 255, 0.2)'
            };
        }
        return {
            top: '#4a9eff',
            mid: '#87ceeb',
            bottom: '#1a73e8',
            glow: 'rgba(255, 220, 150, 0.6)'
        };
    }

    drawRainParticles(ctx, W, H, count) {
        ctx.strokeStyle = 'rgba(180, 210, 255, 0.4)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < count; i++) {
            const x = Math.random() * W;
            const y = Math.random() * H;
            const len = 15 + Math.random() * 25;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 3, y + len);
            ctx.stroke();
        }
    }

    drawSnowParticles(ctx, W, H, count) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        for (let i = 0; i < count; i++) {
            const x = Math.random() * W;
            const y = Math.random() * H;
            const r = 2 + Math.random() * 3;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawCloudParticles(ctx, W, H) {
        for (let i = 0; i < 6; i++) {
            const x = Math.random() * W;
            const y = H * 0.3 + Math.random() * H * 0.3;
            const r = 200 + Math.random() * 200;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
            g.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawSparkles(ctx, W, H, count) {
        for (let i = 0; i < count; i++) {
            const x = Math.random() * W;
            const y = Math.random() * H * 0.7;
            const r = 1 + Math.random() * 2;
            ctx.fillStyle = `rgba(255, 245, 200, ${0.3 + Math.random() * 0.5})`;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ============================================================
       DRAW: HEADER (app name + location)
       ============================================================ */
    async drawHeader(ctx, W, loc) {
        // App icon (cloud + sun)
        this.drawSunIcon(ctx, 90, 100, 28, '#ffd54a');

        // App name
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('EmmiDev Weather', 140, 100);

        // Location
        const label = formatLocationLabel(loc) || loc.name;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.font = '500 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(this.truncate(label, 50), 140, 145);

        // Location pin
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('📍', 90, 145);
    }

    /* ============================================================
       DRAW: MAIN TEMPERATURE
       ============================================================ */
    async drawMainTemp(ctx, W, weather) {
        const temp = Math.round(weather.current.temperature_2m);
        const unit = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric') === 'imperial' ? '°F' : '°C';

        // Big temperature (center)
        ctx.fillStyle = 'rgba(255, 255, 255, 1)';
        ctx.font = 'bold 380px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 40;
        ctx.fillText(`${temp}°`, W / 2, 620);
        ctx.shadowBlur = 0;

        // Unit (below, smaller)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '600 72px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(unit.replace('°', ''), W / 2, 830);
    }

    /* ============================================================
       DRAW: CONDITION + ICON
       ============================================================ */
    async drawCondition(ctx, W, weather) {
        const cond = this.detectCondition(weather.current);
        const desc = this.conditionDescription(weather.current.weather_code);
        const icon = this.conditionEmoji(cond);

        // Icon
        ctx.font = '100px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(icon, W / 2, 980);

        // Description
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = '600 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(desc, W / 2, 1080);

        // High / Low
        const daily = weather.daily;
        if (daily?.temperature_2m_max?.[0] != null) {
            const hi = Math.round(daily.temperature_2m_max[0]);
            const lo = Math.round(daily.temperature_2m_min[0]);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.font = '500 42px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`↑ ${hi}°   ↓ ${lo}°`, W / 2, 1160);
        }
    }

    /* ============================================================
       DRAW: STATS ROW (feels-like, humidity, wind, UV)
       ============================================================ */
    async drawStats(ctx, W, weather) {
        const cur = weather.current;
        const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS, 'metric');
        const isImperial = units === 'imperial';
        const feels = Math.round(cur.apparent_temperature);
        const humidity = Math.round(cur.relative_humidity_2m);
        const wind = isImperial
            ? `${Math.round(cur.wind_speed_10m * 0.621)} mph`
            : `${Math.round(cur.wind_speed_10m)} km/h`;
        const uv = weather.daily?.uv_index_max?.[0];

        const stats = [
            { icon: '🌡️', label: 'Feels', value: `${feels}°` },
            { icon: '💧', label: 'Humid', value: `${humidity}%` },
            { icon: '💨', label: 'Wind', value: wind },
            { icon: '☀️', label: 'UV', value: uv != null ? uv.toFixed(1) : '—' }
        ];

        const boxW = 220;
        const gap = 20;
        const totalW = stats.length * boxW + (stats.length - 1) * gap;
        const startX = (W - totalW) / 2;
        const y = 1260;

        stats.forEach((s, i) => {
            const x = startX + i * (boxW + gap);
            // Box background
            ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
            this.roundRect(ctx, x, y, boxW, 140, 24);
            ctx.fill();

            // Icon
            ctx.font = '48px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(s.icon, x + boxW / 2, y + 50);

            // Label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(s.label, x + boxW / 2, y + 88);

            // Value
            ctx.fillStyle = 'rgba(255, 255, 255, 1)';
            ctx.font = 'bold 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(s.value, x + boxW / 2, y + 122);
        });
    }

    /* ============================================================
       DRAW: ADVICE (one-line actionable tip)
       ============================================================ */
    async drawAdvice(ctx, W, weather, loc) {
        const advice = this.generateAdvice(weather);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = '500 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Wrap text if needed
        const lines = this.wrapText(ctx, advice, W - 200);
        const startY = 1520 - (lines.length - 1) * 22;
        lines.forEach((line, i) => {
            ctx.fillText(line, W / 2, startY + i * 44);
        });
    }

    /* ============================================================
       DRAW: FOOTER (branding + call to action)
       ============================================================ */
    async drawFooter(ctx, W, H) {
        // Divider line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W * 0.2, H - 200);
        ctx.lineTo(W * 0.8, H - 200);
        ctx.stroke();

        // Logo + tagline
        this.drawSunIcon(ctx, W / 2 - 120, H - 140, 24, '#ffd54a');

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('EmmiDev Weather', W / 2 - 75, H - 145);

        // Tagline
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Your Weather, Your World. Free forever.', W / 2, H - 90);

        // URL
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('emimidev.com', W / 2, H - 55);
    }

    /* ============================================================
       HELPERS
       ============================================================ */
    detectCondition(current) {
        const code = current.weather_code;
        if (code >= 95) return 'thunderstorm';
        if (code >= 71 && code <= 77) return 'snow';
        if (code >= 85 && code <= 86) return 'snow';
        if (code >= 51 && code <= 67) return 'rain';
        if (code >= 80 && code <= 82) return 'rain';
        if (code === 45 || code === 48) return 'fog';
        if (Number(current.precipitation) > 0.1) return 'rain';
        if (code >= 1 && code <= 3) return 'clouds';
        return 'clear';
    }

    conditionDescription(code) {
        const map = {
            0: 'Clear Sky', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
            45: 'Foggy', 48: 'Rime Fog',
            51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
            61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
            71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
            80: 'Rain Showers', 81: 'Showers', 82: 'Heavy Showers',
            95: 'Thunderstorm', 96: 'Thunder + Hail', 99: 'Severe Storm'
        };
        return map[code] || 'Weather';
    }

    conditionEmoji(cond) {
        const map = {
            clear: '☀️',
            clouds: '⛅',
            rain: '🌧️',
            thunderstorm: '⛈️',
            snow: '❄️',
            fog: '🌫️'
        };
        return map[cond] || '🌤️';
    }

    generateAdvice(weather) {
        const cur = weather.current;
        const temp = cur.temperature_2m;
        const cond = this.detectCondition(cur);
        const humidity = cur.relative_humidity_2m;
        const uv = weather.daily?.uv_index_max?.[0];

        if (cond === 'thunderstorm') return '⛈️ Stay indoors — thunderstorm outside';
        if (cond === 'rain') return '☔ Grab an umbrella before you head out';
        if (cond === 'snow') return '❄️ Bundle up — snow expected';
        if (cond === 'fog') return '🌫️ Drive carefully — low visibility';

        if (temp > 32) return `🥵 Very hot — drink plenty of water`;
        if (temp > 28) return `☀️ Warm day — stay hydrated`;
        if (temp < 5) return `🧥 Bundle up — cold outside`;
        if (temp < 15) return `🧥 Light jacket recommended`;
        if (uv != null && uv > 7) return `😎 High UV — wear sunscreen`;
        if (humidity > 80) return `💧 Humid — light clothing is best`;

        return `🌤️ Pleasant weather — enjoy your day`;
    }

    drawSunIcon(ctx, x, y, size, color) {
        // Sun circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();

        // Rays
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const x1 = x + Math.cos(angle) * (size + 6);
            const y1 = y + Math.sin(angle) * (size + 6);
            const x2 = x + Math.cos(angle) * (size + 14);
            const y2 = y + Math.sin(angle) * (size + 14);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
    }

    roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines.slice(0, 3);
    }

    truncate(text, max) {
        if (text.length <= max) return text;
        return text.slice(0, max - 1) + '…';
    }

    download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* ============================================================
       OPTIONAL: WEATHER STORY FORMAT (9:16 for Instagram)
       ============================================================ */
    async shareStory() {
        // Same as share() but force the story format
        // (currently generateBlob is already 1080×1920 — perfect for stories)
        return this.share();
    }
}

export const ShareCard = new ShareCardModule();