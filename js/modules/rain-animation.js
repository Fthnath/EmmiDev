/**
 * EmmiDev Weather — Rain Animation
 * Pure Canvas particle system for hero background.
 * Adapts to current weather: rain, snow, clouds, clear.
 */

import { Storage } from '../core/storage.js';
import { Bus, Events } from '../core/events.js';

class RainAnimation {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.overlay = null;
        this.particles = [];
        this.animationId = null;
        this.enabled = true;
        this.condition = 'clear';
        this.isDay = true;
        this.temperature = 20;
        this.windSpeed = 0;
        this.intensity = 1;       // 0..2 multiplier
        this.dpr = 1;
        this.lastTime = 0;
        this.resizeObserver = null;
        this.boundAnimate = this.animate.bind(this);
        this.splashes = [];       // rain impact ripples
        this.fogPatches = [];     // drifting fog for fog conditions
        this.sparkles = [];       // sun sparkles for clear days
    }

    /* ============================================================
       INIT
       ============================================================ */
    init() {
        this.canvas = document.getElementById('heroWeatherCanvas');
        this.overlay = document.getElementById('rainAnimationOverlay');
        if (!this.canvas) {
            console.warn('[RainAnimation] Canvas not found');
            return;
        }

        this.ctx = this.canvas.getContext('2d', { alpha: true });
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);

        // Read settings
        this.enabled = Storage.get('emmidev::rainAnimation', true);
        this.syncToggleButton();

        // Resize
        this.resize();
        this.setupResizeObserver();

        // Listen for settings + weather changes
        this.bindUI();
        this.bindWeatherEvents();

        // Start loop
        this.start();

        console.log('[RainAnimation] Ready');
    }

    bindUI() {
        // Hero quick toggle
        const heroToggle = document.getElementById('heroRainToggle');
        if (heroToggle) {
            heroToggle.addEventListener('click', () => {
                this.enabled = !this.enabled;
                Storage.set('emmidev::rainAnimation', this.enabled);
                this.syncToggleButton();
                if (this.enabled) this.restart();
                else this.clearCanvas();
            });
        }

        // Settings toggle
        const settingsToggle = document.getElementById('rainAnimSetting');
        if (settingsToggle) {
            settingsToggle.checked = this.enabled;
            settingsToggle.addEventListener('change', () => {
                this.enabled = settingsToggle.checked;
                Storage.set('emmidev::rainAnimation', this.enabled);
                this.syncToggleButton();
                if (this.enabled) this.restart();
                else this.clearCanvas();
            });
        }
    }

    syncToggleButton() {
        const btn = document.getElementById('heroRainToggle');
        if (!btn) return;
        btn.setAttribute('aria-pressed', String(this.enabled));
        btn.classList.toggle('is-active', this.enabled);
    }

    bindWeatherEvents() {
        // Existing scene setter (from weather.js)
        window.__setWeatherScene = (data) => this.setWeather(data);

        // Also listen to bus events in case weather.js emits
        Bus.on(Events.WEATHER_LOADED, ({ weather }) => {
            if (!weather?.current) return;
            this.setWeather({
                condition: this.detectCondition(weather.current),
                isDay: weather.current.is_day === 1,
                temperature: weather.current.temperature_2m,
                windSpeed: weather.current.wind_speed_10m || 0,
                weatherCode: weather.current.weather_code
            });
        });
    }

    detectCondition(current) {
        if (!current) return 'clear';
        const code = current.weather_code;
        const precip = Number(current.precipitation) || 0;
        if (code >= 95) return 'thunderstorm';
        if (code >= 71 && code <= 77) return 'snow';
        if (code >= 85 && code <= 86) return 'snow';
        if (code >= 51 && code <= 67) return 'rain';
        if (code >= 80 && code <= 82) return 'rain';
        if (code === 45 || code === 48) return 'fog';
        if (precip > 0.1) return 'rain';
        if (code >= 1 && code <= 3) return 'clouds';
        return 'clear';
    }

    /* ============================================================
       WEATHER STATE
       ============================================================ */
    setWeather({ condition, isDay, temperature, windSpeed }) {
        const prevCondition = this.condition;

        this.condition = condition || 'clear';
        this.isDay = isDay !== false;
        this.temperature = Number(temperature) || 20;
        this.windSpeed = Number(windSpeed) || 0;

        // Adjust intensity based on wind
        this.intensity = 1 + Math.min(this.windSpeed / 40, 1.2);

        // Rebuild particles when condition changes
        if (prevCondition !== this.condition) {
            this.restart();
        }

        // Update canvas fade class based on condition
        if (this.overlay) {
            this.overlay.dataset.condition = this.condition;
        }
    }

    /* ============================================================
       RESIZE
       ============================================================ */
    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(rect.width, window.innerWidth);
        const h = Math.max(rect.height, window.innerHeight);

        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;

        if (this.ctx) {
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }

        this.width = w;
        this.height = h;

        // Rebuild particles for new size
        this.rebuildParticles();
    }

    setupResizeObserver() {
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', () => this.resize());
            return;
        }
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas);
    }

    /* ============================================================
       PARTICLE BUILDERS
       ============================================================ */
    rebuildParticles() {
        const w = this.width;
        const h = this.height;
        if (!w || !h) return;

        this.particles = [];
        this.splashes = [];
        this.fogPatches = [];
        this.sparkles = [];

        switch (this.condition) {
            case 'rain':
            case 'thunderstorm':
                this.buildRain();
                break;
            case 'snow':
                this.buildSnow();
                break;
            case 'fog':
                this.buildFog();
                break;
            case 'clouds':
                this.buildClouds();
                break;
            default:
                if (this.isDay) this.buildSparkles();
                break;
        }
    }

    buildRain() {
        const count = Math.floor((this.width * this.height) / 6000 * this.intensity);
        for (let i = 0; i < count; i++) {
            this.particles.push({
                type: 'rain',
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                len: 10 + Math.random() * 18,
                speed: 8 + Math.random() * 8,
                wind: this.windSpeed * 0.15,
                opacity: 0.3 + Math.random() * 0.5,
                width: 0.8 + Math.random() * 0.6
            });
        }
    }

    buildSnow() {
        const count = Math.floor((this.width * this.height) / 12000 * this.intensity);
        for (let i = 0; i < count; i++) {
            this.particles.push({
                type: 'snow',
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                r: 1.5 + Math.random() * 2.5,
                speed: 0.6 + Math.random() * 1.2,
                drift: (Math.random() - 0.5) * 0.6,
                wobble: Math.random() * Math.PI * 2,
                wobbleSpeed: 0.01 + Math.random() * 0.02,
                opacity: 0.5 + Math.random() * 0.5
            });
        }
    }

    buildFog() {
        const count = 8;
        for (let i = 0; i < count; i++) {
            this.fogPatches.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height * 0.6,
                w: 300 + Math.random() * 400,
                h: 120 + Math.random() * 160,
                speed: 0.15 + Math.random() * 0.3,
                opacity: 0.08 + Math.random() * 0.12
            });
        }
    }

    buildClouds() {
        const count = 5;
        for (let i = 0; i < count; i++) {
            this.fogPatches.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height * 0.5,
                w: 400 + Math.random() * 300,
                h: 100 + Math.random() * 100,
                speed: 0.2 + Math.random() * 0.4,
                opacity: 0.05 + Math.random() * 0.08
            });
        }
    }

    buildSparkles() {
        const count = 30;
        for (let i = 0; i < count; i++) {
            this.sparkles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height * 0.7,
                r: 0.5 + Math.random() * 1.5,
                phase: Math.random() * Math.PI * 2,
                speed: 0.01 + Math.random() * 0.02,
                opacity: 0.15 + Math.random() * 0.4
            });
        }
    }

    /* ============================================================
       ANIMATION LOOP
       ============================================================ */
    start() {
        this.lastTime = performance.now();
        this.animationId = requestAnimationFrame(this.boundAnimate);
    }

    restart() {
        this.clearCanvas();
        this.rebuildParticles();
        if (!this.animationId) this.start();
    }

    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    clearCanvas() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.width, this.height);
    }

    animate(now) {
        const dt = Math.min((now - this.lastTime) / 16.67, 2); // normalize to ~60fps units
        this.lastTime = now;

        if (!this.enabled) {
            this.animationId = requestAnimationFrame(this.boundAnimate);
            return;
        }

        this.ctx.clearRect(0, 0, this.width, this.height);

        switch (this.condition) {
            case 'rain':
            case 'thunderstorm':
                this.drawRain(dt);
                this.drawSplashes(dt);
                break;
            case 'snow':
                this.drawSnow(dt);
                break;
            case 'fog':
                this.drawFog(dt);
                break;
            case 'clouds':
                this.drawClouds(dt);
                break;
            default:
                this.drawSparkles(dt);
                break;
        }

        this.animationId = requestAnimationFrame(this.boundAnimate);
    }

    /* ============================================================
       DRAW: RAIN
       ============================================================ */
    drawRain(dt) {
        const ctx = this.ctx;
        ctx.lineCap = 'round';

        for (const p of this.particles) {
            if (p.type !== 'rain') continue;

            ctx.strokeStyle = `rgba(180, 210, 255, ${p.opacity})`;
            ctx.lineWidth = p.width;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + p.wind * 0.3, p.y + p.len);
            ctx.stroke();

            p.x += p.wind * dt;
            p.y += p.speed * dt;

            // Recycle when off-screen
            if (p.y > this.height + p.len) {
                // Maybe create a splash
                if (Math.random() < 0.08) {
                    this.splashes.push({
                        x: p.x,
                        y: this.height - 4,
                        r: 0,
                        maxR: 6 + Math.random() * 8,
                        opacity: 0.5
                    });
                }
                p.y = -p.len;
                p.x = Math.random() * this.width;
            }
            if (p.x > this.width + 20) p.x = -20;
            if (p.x < -20) p.x = this.width + 20;
        }
    }

    drawSplashes(dt) {
        const ctx = this.ctx;
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const s = this.splashes[i];
            s.r += 0.8 * dt;
            s.opacity -= 0.02 * dt;
            if (s.opacity <= 0 || s.r >= s.maxR) {
                this.splashes.splice(i, 1);
                continue;
            }
            ctx.strokeStyle = `rgba(180, 210, 255, ${s.opacity})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(s.x, s.y, s.r, s.r * 0.35, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    /* ============================================================
       DRAW: SNOW
       ============================================================ */
    drawSnow(dt) {
        const ctx = this.ctx;
        for (const p of this.particles) {
            if (p.type !== 'snow') continue;

            p.wobble += p.wobbleSpeed * dt;
            const wobbleX = Math.sin(p.wobble) * 0.8;

            ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
            ctx.beginPath();
            ctx.arc(p.x + wobbleX, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();

            p.x += (p.drift + wobbleX * 0.3 + this.windSpeed * 0.05) * dt;
            p.y += p.speed * dt;

            if (p.y > this.height + p.r) {
                p.y = -p.r;
                p.x = Math.random() * this.width;
            }
            if (p.x > this.width + 10) p.x = -10;
            if (p.x < -10) p.x = this.width + 10;
        }
    }

    /* ============================================================
       DRAW: FOG / CLOUDS
       ============================================================ */
    drawFog(dt) {
        const ctx = this.ctx;
        for (const patch of this.fogPatches) {
            const gradient = ctx.createRadialGradient(
                patch.x, patch.y, 0,
                patch.x, patch.y, patch.w
            );
            gradient.addColorStop(0, `rgba(220, 230, 245, ${patch.opacity})`);
            gradient.addColorStop(1, 'rgba(220, 230, 245, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.ellipse(patch.x, patch.y, patch.w, patch.h, 0, 0, Math.PI * 2);
            ctx.fill();

            patch.x += patch.speed * dt;
            if (patch.x - patch.w > this.width) {
                patch.x = -patch.w;
                patch.y = Math.random() * this.height * 0.6;
            }
        }
    }

    drawClouds(dt) {
        const ctx = this.ctx;
        for (const patch of this.fogPatches) {
            const gradient = ctx.createRadialGradient(
                patch.x, patch.y, 0,
                patch.x, patch.y, patch.w
            );
            gradient.addColorStop(0, `rgba(255, 255, 255, ${patch.opacity})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.ellipse(patch.x, patch.y, patch.w, patch.h, 0, 0, Math.PI * 2);
            ctx.fill();

            patch.x += (patch.speed + this.windSpeed * 0.02) * dt;
            if (patch.x - patch.w > this.width) {
                patch.x = -patch.w;
                patch.y = Math.random() * this.height * 0.5;
            }
        }
    }

    /* ============================================================
       DRAW: SUN SPARKLES (clear day)
       ============================================================ */
    drawSparkles(dt) {
        const ctx = this.ctx;
        for (const s of this.sparkles) {
            s.phase += s.speed * dt;
            const twinkle = (Math.sin(s.phase) + 1) / 2;
            const opacity = s.opacity * twinkle;

            ctx.fillStyle = `rgba(255, 240, 200, ${opacity})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * (0.8 + twinkle * 0.4), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ============================================================
       CLEANUP
       ============================================================ */
    destroy() {
        this.stop();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        window.__setWeatherScene = null;
    }
}

export const RainAnim = new RainAnimation();