/**
 * EmmiDev Weather — Animated Weather Engine
 * Canvas-based, 60fps, weather-reactive scenes.
 *
 * Features:
 *   - 3D-perspective human figures (walking, umbrella, weather-appropriate)
 *   - Rain with splash + puddles + lightning
 *   - Sun with rays + heat shimmer
 *   - Drifting clouds (layered)
 *   - Swaying trees with leaf particles
 *   - Snow with accumulation
 *   - Wind particles + tree bend
 *   - Stars + moon at night
 *   - Birds flying in clear weather
 *   - Time-of-day color grading
 */

export class WeatherScene {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        
        this.condition = 'clear';
        this.isDay = true;
        this.temperature = 20;
        this.windSpeed = 0;
        this.intensity = 'moderate';
        
        this.frame = 0;
        this.running = false;
        
        this.particles = {
            rain: [],
            snow: [],
            leaves: [],
            dust: [],
            birds: [],
            stars: [],
            puddles: [],
            splash: []
        };
        
        this.clouds = [];
        this.trees = [];
        this.persons = [];
        this.lightning = { active: false, flash: 0, next: 0 };
        
        this._boundAnimate = this._animate.bind(this);
        this._boundResize = this.resize.bind(this);
        
        this.resize();
        window.addEventListener('resize', this._boundResize);
    }
    
    // ---------- SETUP ----------
    
    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = rect.width || window.innerWidth;
        const h = rect.height || 500;
        this.width = w;
        this.height = h;
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(this.dpr, this.dpr);
        
        this.groundY = h * 0.78;
        this.horizonY = h * 0.55;
        
        this._rebuildScene();
    }
    
    setWeather({ condition, isDay, temperature, windSpeed }) {
        const conditionChanged = this.condition !== condition;
        const dayChanged = this.isDay !== isDay;
        
        this.condition = condition || 'clear';
        this.isDay = isDay !== false;
        if (temperature != null) this.temperature = temperature;
        if (windSpeed != null) this.windSpeed = windSpeed;
        
        if (conditionChanged || dayChanged) {
            this._rebuildScene();
        }
    }
    
    _rebuildScene() {
        this._initClouds();
        this._initTrees();
        this._initPersons();
        this._initParticles();
        this._initBirds();
        this._initStars();
    }
    
    _initClouds() {
        this.clouds = [];
        const isStormy = ['thunderstorm'].includes(this.condition);
        const isRainy  = ['rain', 'drizzle'].includes(this.condition);
        const isCloudy = ['clouds', 'fog'].includes(this.condition);
        const count = isStormy ? 8 : isRainy ? 6 : isCloudy ? 5 : 3;
        
        for (let i = 0; i < count; i++) {
            this.clouds.push({
                x: Math.random() * this.width,
                y: 40 + Math.random() * this.horizonY * 0.6,
                r: 40 + Math.random() * 70,
                speed: 0.15 + Math.random() * 0.4,
                opacity: isStormy ? 0.85 : 0.6 + Math.random() * 0.3,
                dark: isStormy || isRainy
            });
        }
    }
    
    _initTrees() {
        this.trees = [];
        const count = Math.max(2, Math.floor(this.width / 300));
        for (let i = 0; i < count; i++) {
            const x = (i + 0.5) * (this.width / count) + (Math.random() - 0.5) * 40;
            this.trees.push({
                x,
                y: this.groundY,
                height: 60 + Math.random() * 50,
                width: 30 + Math.random() * 20,
                sway: Math.random() * Math.PI * 2,
                swayAmp: 0.02 + Math.random() * 0.03
            });
        }
    }
    
    _initPersons() {
        this.persons = [];
        const showUmbrella = ['rain', 'drizzle', 'thunderstorm'].includes(this.condition);
        // 2-3 persons at different depths
        for (let i = 0; i < 3; i++) {
            const depth = i / 2;
            this.persons.push({
                x: Math.random() * this.width,
                speed: 0.3 + Math.random() * 0.4,
                scale: 0.7 + depth * 0.6,
                y: this.groundY + depth * 20,
                step: Math.random() * Math.PI * 2,
                umbrella: showUmbrella,
                coat: this.temperature < 12 ? 'heavy' : this.temperature > 28 ? 'light' : 'normal'
            });
        }
    }
    
    _initParticles() {
        this.particles.rain = [];
        this.particles.snow = [];
        this.particles.leaves = [];
        this.particles.dust = [];
        this.particles.puddles = [];
        this.particles.splash = [];
        
        if (['rain', 'drizzle', 'thunderstorm'].includes(this.condition)) {
            const count = this.condition === 'thunderstorm' ? 220
                        : this.condition === 'rain' ? 150 : 80;
            for (let i = 0; i < count; i++) {
                this.particles.rain.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.height,
                    len: 8 + Math.random() * 14,
                    speed: 6 + Math.random() * 8,
                    opacity: 0.3 + Math.random() * 0.5
                });
            }
            // Puddles on the ground
            for (let i = 0; i < 6; i++) {
                this.particles.puddles.push({
                    x: Math.random() * this.width,
                    y: this.groundY + 10 + Math.random() * 40,
                    rx: 30 + Math.random() * 60,
                    ry: 4 + Math.random() * 6,
                    shimmer: Math.random() * Math.PI * 2
                });
            }
        }
        
        if (this.condition === 'snow') {
            for (let i = 0; i < 120; i++) {
                this.particles.snow.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.height,
                    r: 1 + Math.random() * 3,
                    speed: 0.5 + Math.random() * 1.5,
                    drift: (Math.random() - 0.5) * 0.8,
                    wobble: Math.random() * Math.PI * 2
                });
            }
        }
        
        // Leaves when windy or autumn
        if (this.windSpeed > 5 || this.condition === 'windy') {
            for (let i = 0; i < 25; i++) {
                this.particles.leaves.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.height,
                    size: 4 + Math.random() * 4,
                    rot: Math.random() * Math.PI * 2,
                    rotSpeed: (Math.random() - 0.5) * 0.1,
                    vx: 1 + Math.random() * 2,
                    vy: 0.3 + Math.random() * 0.8,
                    color: `hsl(${20 + Math.random() * 40}, 70%, ${40 + Math.random() * 20}%)`
                });
            }
        }
        
        // Dust for dry/clear + hot
        if (this.temperature > 28 && this.condition === 'clear') {
            for (let i = 0; i < 30; i++) {
                this.particles.dust.push({
                    x: Math.random() * this.width,
                    y: this.groundY - 20 + Math.random() * 40,
                    vx: 0.3 + Math.random() * 0.5,
                    size: 1 + Math.random() * 1.5,
                    opacity: 0.2 + Math.random() * 0.3
                });
            }
        }
    }
    
    _initBirds() {
        this.particles.birds = [];
        if (this.condition === 'clear' && this.isDay) {
            for (let i = 0; i < 5; i++) {
                this.particles.birds.push({
                    x: Math.random() * this.width,
                    y: this.horizonY - 40 - Math.random() * 80,
                    vx: 0.6 + Math.random() * 0.4,
                    flap: Math.random() * Math.PI * 2,
                    flapSpeed: 0.15 + Math.random() * 0.1,
                    size: 3 + Math.random() * 3
                });
            }
        }
    }
    
    _initStars() {
        this.particles.stars = [];
        if (!this.isDay) {
            for (let i = 0; i < 80; i++) {
                this.particles.stars.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.horizonY * 0.9,
                    r: 0.5 + Math.random() * 1.4,
                    twinkle: Math.random() * Math.PI * 2,
                    twinkleSpeed: 0.02 + Math.random() * 0.04
                });
            }
        }
    }
    
    // ---------- ANIMATION LOOP ----------
    
    start() {
        if (this.running) return;
        this.running = true;
        this.frame = 0;
        requestAnimationFrame(this._boundAnimate);
    }
    
    stop() {
        this.running = false;
    }
    
    _animate() {
        if (!this.running) return;
        this.frame++;
        this._draw();
        requestAnimationFrame(this._boundAnimate);
    }
    
    _draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        
        // 1. Sky gradient (time-of-day aware)
        this._drawSky();
        
        // 2. Stars (night only) — behind everything
        if (!this.isDay) this._drawStars();
        
        // 3. Sun or Moon
        if (this.isDay && !['rain', 'thunderstorm'].includes(this.condition)) {
            this._drawSun();
        } else if (!this.isDay) {
            this._drawMoon();
        }
        
        // 4. Birds (clear day)
        if (this.particles.birds.length) this._drawBirds();
        
        // 5. Clouds
        this._drawClouds();
        
        // 6. Ground
        this._drawGround();
        
        // 7. Trees (behind humans)
        this._drawTrees();
        
        // 8. Puddles (rain)
        if (this.particles.puddles.length) this._drawPuddles();
        
        // 9. Humans (3D-perspective)
        this._drawPersons();
        
        // 10. Weather particles (rain/snow/leaves/dust)
        this._drawRain();
        this._drawSnow();
        this._drawLeaves();
        this._drawDust();
        this._drawSplash();
        
        // 11. Lightning flash (storm)
        if (this.condition === 'thunderstorm') this._drawLightning();
        
        // 12. Heat shimmer (very hot day)
        if (this.isDay && this.temperature > 32) this._drawHeatShimmer();
    }
    
    // ---------- DRAWING PRIMITIVES ----------
    
    _drawSky() {
        const ctx = this.ctx;
        const g = ctx.createLinearGradient(0, 0, 0, this.height);
        
        if (this.condition === 'thunderstorm') {
            g.addColorStop(0, '#1a1a2e');
            g.addColorStop(0.6, '#2c2c44');
            g.addColorStop(1, '#3a3a55');
        } else if (this.condition === 'rain' || this.condition === 'drizzle') {
            g.addColorStop(0, '#2c3e50');
            g.addColorStop(1, '#4a6478');
        } else if (this.condition === 'clouds') {
            g.addColorStop(0, this.isDay ? '#7a8a9a' : '#1a2332');
            g.addColorStop(1, this.isDay ? '#b0bec5' : '#2a3444');
        } else if (this.condition === 'snow') {
            g.addColorStop(0, '#8899aa');
            g.addColorStop(1, '#d8e0e8');
        } else if (this.condition === 'fog') {
            g.addColorStop(0, '#a8b4c0');
            g.addColorStop(1, '#d8dce0');
        } else if (this.isDay) {
            // Clear day
            g.addColorStop(0, '#1a2980');
            g.addColorStop(0.5, '#4a90d9');
            g.addColorStop(1, '#87ceeb');
        } else {
            // Clear night
            g.addColorStop(0, '#05050f');
            g.addColorStop(0.6, '#0f1a3a');
            g.addColorStop(1, '#1a2a4a');
        }
        
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.width, this.height);
    }
    
    _drawSun() {
        const ctx = this.ctx;
        const sunX = this.width * 0.78;
        const sunY = this.height * 0.22 + Math.sin(this.frame * 0.002) * 4;
        
        // Glow
        const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 120);
        glow.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
        glow.addColorStop(0.4, 'rgba(255, 220, 120, 0.4)');
        glow.addColorStop(1, 'rgba(255, 200, 100, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(sunX, sunY, 120, 0, Math.PI * 2);
        ctx.fill();
        
        // Core
        ctx.fillStyle = 'rgba(255, 245, 200, 1)';
        ctx.beginPath();
        ctx.arc(sunX, sunY, 38, 0, Math.PI * 2);
        ctx.fill();
        
        // Rotating rays
        ctx.save();
        ctx.translate(sunX, sunY);
        ctx.rotate(this.frame * 0.002);
        for (let i = 0; i < 12; i++) {
            ctx.rotate(Math.PI / 6);
            ctx.beginPath();
            ctx.moveTo(48, 0);
            ctx.lineTo(70, 0);
            ctx.strokeStyle = 'rgba(255, 240, 180, 0.6)';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }
    
    _drawMoon() {
        const ctx = this.ctx;
        const mx = this.width * 0.75;
        const my = this.height * 0.2;
        
        // Glow
        const glow = ctx.createRadialGradient(mx, my, 0, mx, my, 80);
        glow.addColorStop(0, 'rgba(220, 230, 255, 0.5)');
        glow.addColorStop(1, 'rgba(220, 230, 255, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(mx, my, 80, 0, Math.PI * 2);
        ctx.fill();
        
        // Moon
        ctx.fillStyle = '#e8eef5';
        ctx.beginPath();
        ctx.arc(mx, my, 30, 0, Math.PI * 2);
        ctx.fill();
        
        // Craters
        ctx.fillStyle = 'rgba(180, 190, 210, 0.5)';
        const craters = [[-8, -6, 6], [6, 4, 8], [-4, 10, 4], [10, -10, 3]];
        craters.forEach(([dx, dy, r]) => {
            ctx.beginPath();
            ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    _drawStars() {
        const ctx = this.ctx;
        this.particles.stars.forEach(s => {
            const tw = 0.5 + 0.5 * Math.sin(this.frame * s.twinkleSpeed + s.twinkle);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + tw * 0.6})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    _drawBirds() {
        const ctx = this.ctx;
        ctx.strokeStyle = 'rgba(30, 30, 40, 0.8)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        
        this.particles.birds.forEach(b => {
            b.x += b.vx;
            b.flap += b.flapSpeed;
            if (b.x > this.width + 20) { b.x = -20; b.y = this.horizonY - 40 - Math.random() * 80; }
            
            const flapY = Math.sin(b.flap) * 3;
            ctx.beginPath();
            ctx.moveTo(b.x - b.size, b.y + flapY);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(b.x + b.size, b.y + flapY);
            ctx.stroke();
        });
    }
    
    _drawClouds() {
        const ctx = this.ctx;
        const wind = Math.max(0.2, this.windSpeed / 20);
        
        this.clouds.forEach(c => {
            c.x += c.speed * wind;
            if (c.x - c.r > this.width) {
                c.x = -c.r;
                c.y = 40 + Math.random() * this.horizonY * 0.6;
            }
            
            ctx.save();
            ctx.globalAlpha = c.opacity;
            const color = c.dark ? 'rgba(60, 60, 80,' : 'rgba(255, 255, 255,';
            ctx.fillStyle = color + '1)';
            
            // Layered puffs
            const puffs = [
                [0, 0, c.r],
                [c.r * 0.7, -c.r * 0.2, c.r * 0.85],
                [-c.r * 0.75, -c.r * 0.15, c.r * 0.75],
                [c.r * 0.3, c.r * 0.15, c.r * 0.7],
                [-c.r * 0.4, c.r * 0.25, c.r * 0.65]
            ];
            puffs.forEach(([dx, dy, r]) => {
                ctx.beginPath();
                ctx.arc(c.x + dx, c.y + dy, r, 0, Math.PI * 2);
                ctx.fill();
            });
            
            ctx.restore();
        });
    }
    
    _drawGround() {
        const ctx = this.ctx;
        
        // Ground color depends on weather
        let groundColor;
        if (this.condition === 'snow') groundColor = '#dde6ee';
        else if (this.condition === 'rain' || this.condition === 'thunderstorm') groundColor = '#2a3540';
        else if (this.condition === 'drizzle') groundColor = '#3a4550';
        else if (!this.isDay) groundColor = '#141e2c';
        else groundColor = '#4a6b3a';
        
        // Ground fill
        ctx.fillStyle = groundColor;
        ctx.fillRect(0, this.groundY, this.width, this.height - this.groundY);
        
        // Slight grass tufts on top edge
        if (this.condition !== 'snow') {
            ctx.fillStyle = this.isDay ? 'rgba(80, 120, 60, 0.7)' : 'rgba(40, 60, 40, 0.7)';
            const spacing = 8;
            for (let x = 0; x < this.width; x += spacing) {
                const h = 3 + Math.sin((x + this.frame * 0.5) * 0.1) * 2;
                ctx.fillRect(x, this.groundY - h, 2, h);
            }
        }
    }
    
    _drawTrees() {
        const ctx = this.ctx;
        const windFactor = Math.min(1, this.windSpeed / 25);
        const isStorm = this.condition === 'thunderstorm';
        
        this.trees.forEach(t => {
            const sway = Math.sin(this.frame * 0.02 + t.sway) * t.swayAmp * (1 + windFactor * 2) + (isStorm ? Math.sin(this.frame * 0.4) * 0.02 : 0);
            
            ctx.save();
            ctx.translate(t.x, t.y);
            ctx.rotate(sway);
            
            // Trunk
            ctx.fillStyle = '#3b2a1a';
            ctx.fillRect(-t.width * 0.15, -t.height * 0.6, t.width * 0.3, t.height * 0.6);
            
            // Canopy — 3 overlapping blobs
            const leafColor = this.condition === 'snow'
                ? '#e8eef5'
                : !this.isDay
                ? '#1a3520'
                : this.temperature > 25
                ? '#5a9a3a'
                : '#3a7a2a';
            
            ctx.fillStyle = leafColor;
            ctx.beginPath();
            ctx.arc(0, -t.height * 0.7, t.width * 0.6, 0, Math.PI * 2);
            ctx.arc(-t.width * 0.4, -t.height * 0.85, t.width * 0.45, 0, Math.PI * 2);
            ctx.arc(t.width * 0.4, -t.height * 0.85, t.width * 0.45, 0, Math.PI * 2);
            ctx.arc(0, -t.height * 0.95, t.width * 0.5, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.restore();
        });
    }
    
    _drawPersons() {
        // Sort by scale so far ones draw first
        const sorted = [...this.persons].sort((a, b) => a.scale - b.scale);
        
        sorted.forEach(p => {
            // Walking motion
            const dx = p.speed * (this.windSpeed > 15 ? 1.4 : 1);
            p.x += dx;
            if (p.x > this.width + 40) {
                p.x = -40;
                p.y = this.groundY + (p.scale - 0.7) * 20;
            }
            p.step += 0.15;
            
            this._drawHuman(p.x, p.y, p.scale, p.umbrella, p.step, p.coat);
        });
    }
    
    /**
     * Draw a 3D-perspective human figure.
     * Uses shading to fake 3D — front-lit + shadows + rounded joints.
     */
    _drawHuman(x, y, scale, umbrella, step, coat) {
        const ctx = this.ctx;
        const s = scale;
        
        // Proportions
        const headR = 10 * s;
        const torsoH = 42 * s;
        const armL = 28 * s;
        const legL = 38 * s;
        const torsoW = 14 * s;
        
        // Walking cycle
        const legSwing = Math.sin(step) * 14 * s;
        const armSwing = -Math.sin(step) * 12 * s;
        
        // Shadow on ground
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(x, y + 4, torsoW * 1.2, 4 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        // Skin tone
        const skin = '#f4c9a8';
        const skinShadow = '#d9a67f';
        
        // Coat color by weather
        let coatColor = '#2e4a6b';
        let coatShadow = '#1e3550';
        if (coat === 'heavy') { coatColor = '#3a2a2a'; coatShadow = '#241818'; }
        else if (coat === 'light') { coatColor = '#e8ddc4'; coatShadow = '#c9bfa5'; }
        
        // --------- LEGS (behind torso) ---------
        this._limb(x, y - torsoH, legSwing, -legSwing, legL, 6 * s, '#3a3a4a', skin, 'bottom');
        
        // --------- TORSO ---------
        ctx.save();
        ctx.fillStyle = coatColor;
        ctx.beginPath();
        ctx.moveTo(x - torsoW / 2, y - torsoH);
        ctx.lineTo(x + torsoW / 2, y - torsoH);
        ctx.lineTo(x + torsoW * 0.45, y - 2 * s);
        ctx.lineTo(x - torsoW * 0.45, y - 2 * s);
        ctx.closePath();
        ctx.fill();
        
        // Torso shadow (3D effect)
        ctx.fillStyle = coatShadow;
        ctx.beginPath();
        ctx.moveTo(x + torsoW * 0.1, y - torsoH);
        ctx.lineTo(x + torsoW / 2, y - torsoH);
        ctx.lineTo(x + torsoW * 0.45, y - 2 * s);
        ctx.lineTo(x + torsoW * 0.05, y - 2 * s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        
        // --------- ARMS ---------
        if (!umbrella) {
            // Both arms swinging
            this._limb(x - torsoW * 0.4, y - torsoH + 4 * s, armSwing, 0, armL, 5 * s, skin, skinShadow, 'arm-left');
            this._limb(x + torsoW * 0.4, y - torsoH + 4 * s, -armSwing, 0, armL, 5 * s, skin, skinShadow, 'arm-right');
        } else {
            // Left arm swings, right arm up (holding umbrella)
            this._limb(x - torsoW * 0.4, y - torsoH + 4 * s, armSwing, 0, armL, 5 * s, skin, skinShadow, 'arm-left');
            
            ctx.save();
            ctx.strokeStyle = skin;
            ctx.lineWidth = 5 * s;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x + torsoW * 0.4, y - torsoH + 4 * s);
            ctx.lineTo(x + torsoW * 0.6, y - torsoH - 12 * s);
            ctx.stroke();
            ctx.restore();
        }
        
        // --------- HEAD ---------
        ctx.save();
        // Base
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(x, y - torsoH - headR - 2 * s, headR, 0, Math.PI * 2);
        ctx.fill();
        // Shadow side
        ctx.fillStyle = skinShadow;
        ctx.beginPath();
        ctx.arc(x + 3 * s, y - torsoH - headR - 2 * s, headR * 0.85, -Math.PI * 0.4, Math.PI * 0.7);
        ctx.fill();
        // Hair
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(x, y - torsoH - headR - 4 * s, headR * 0.95, Math.PI * 1.05, Math.PI * 2.05);
        ctx.fill();
        ctx.restore();
        
        // --------- UMBRELLA ---------
        if (umbrella) {
            const ux = x + torsoW * 0.6;
            const uy = y - torsoH - 12 * s;
            const uCanopyY = uy - 55 * s;
            
            // Handle
            ctx.save();
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2.5 * s;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(ux, uy);
            ctx.lineTo(ux, uCanopyY + 10 * s);
            ctx.stroke();
            ctx.restore();
            
            // Canopy — dome
            const colors = this.condition === 'thunderstorm' ? ['#1a1a2e', '#2c2c44'] : ['#e63946', '#c8283a'];
            const canopyR = 32 * s;
            
            ctx.save();
            const grad = ctx.createLinearGradient(ux - canopyR, uCanopyY, ux + canopyR, uCanopyY);
            grad.addColorStop(0, colors[1]);
            grad.addColorStop(0.5, colors[0]);
            grad.addColorStop(1, colors[1]);
            ctx.fillStyle = grad;
            
            ctx.beginPath();
            ctx.moveTo(ux - canopyR, uCanopyY);
            ctx.arc(ux, uCanopyY, canopyR, Math.PI, 0);
            ctx.closePath();
            ctx.fill();
            
            // Ribs
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 1 * s;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(ux, uCanopyY);
                const ribX = ux + i * (canopyR / 3);
                const ribY = uCanopyY - Math.sqrt(Math.max(0, canopyR * canopyR - (i * canopyR / 3) ** 2));
                ctx.lineTo(ribX, ribY);
                ctx.stroke();
            }
            
            // Top tip
            ctx.fillStyle = colors[1];
            ctx.beginPath();
            ctx.arc(ux, uCanopyY - 2, 2 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
    
    /**
     * Draw a limb (arm or leg).
     * type: 'leg' | 'arm-left' | 'arm-right'
     */
    _limb(originX, originY, swing1, swing2, length, thickness, color, shadowColor, type) {
        const ctx = this.ctx;
        
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const x1 = originX + swing1;
        const x2 = originX + swing2;
        const yEnd = originY + length;
        
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.quadraticCurveTo(originX + swing1 * 0.5, originY + length * 0.5, x1, yEnd);
        ctx.stroke();
        
        // Second leg for legs
        if (type === 'bottom') {
            ctx.beginPath();
            ctx.moveTo(originX, originY);
            ctx.quadraticCurveTo(originX + swing2 * 0.5, originY + length * 0.5, x2, yEnd);
            ctx.stroke();
            
            // Feet
            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.arc(x1, yEnd, thickness * 0.7, 0, Math.PI * 2);
            ctx.arc(x2, yEnd, thickness * 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
    
    _drawPuddles() {
        const ctx = this.ctx;
        this.particles.puddles.forEach(p => {
            p.shimmer += 0.03;
            ctx.save();
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rx);
            const alpha = 0.4 + Math.sin(p.shimmer) * 0.1;
            grad.addColorStop(0, `rgba(120, 160, 200, ${alpha})`);
            grad.addColorStop(1, 'rgba(80, 120, 160, 0.1)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }
    
    _drawRain() {
        if (!this.particles.rain.length) return;
        const ctx = this.ctx;
        const windSlant = this.windSpeed > 10 ? this.windSpeed * 0.08 : 0;
        
        ctx.strokeStyle = this.condition === 'thunderstorm'
            ? 'rgba(180, 200, 255, 0.7)'
            : 'rgba(180, 200, 230, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        
        this.particles.rain.forEach(drop => {
            drop.x += windSlant;
            drop.y += drop.speed;
            
            if (drop.y > this.groundY) {
                // Spawn splash
                if (this.particles.splash.length < 40) {
                    this.particles.splash.push({
                        x: drop.x,
                        y: this.groundY,
                        r: 1,
                        maxR: 6 + Math.random() * 4,
                        alpha: 0.7
                    });
                }
                drop.y = -10;
                drop.x = Math.random() * this.width;
            }
            if (drop.x > this.width + 5) drop.x = -5;
            if (drop.x < -5) drop.x = this.width + 5;
            
            ctx.beginPath();
            ctx.moveTo(drop.x, drop.y);
            ctx.lineTo(drop.x - windSlant * 2, drop.y + drop.len);
            ctx.stroke();
        });
    }
    
    _drawSplash() {
        if (!this.particles.splash.length) return;
        const ctx = this.ctx;
        for (let i = this.particles.splash.length - 1; i >= 0; i--) {
            const s = this.particles.splash[i];
            s.r += 0.4;
            s.alpha -= 0.05;
            if (s.alpha <= 0 || s.r > s.maxR) {
                this.particles.splash.splice(i, 1);
                continue;
            }
            ctx.strokeStyle = `rgba(200, 220, 240, ${s.alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(s.x, s.y, s.r, s.r * 0.4, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    
    _drawSnow() {
        if (!this.particles.snow.length) return;
        const ctx = this.ctx;
        this.particles.snow.forEach(f => {
            f.wobble += 0.05;
            f.x += f.drift + Math.sin(f.wobble) * 0.5;
            f.y += f.speed;
            
            if (f.y > this.groundY) {
                f.y = -5;
                f.x = Math.random() * this.width;
            }
            if (f.x > this.width) f.x = 0;
            if (f.x < 0) f.x = this.width;
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    _drawLeaves() {
        if (!this.particles.leaves.length) return;
        const ctx = this.ctx;
        this.particles.leaves.forEach(l => {
            l.x += l.vx;
            l.y += l.vy;
            l.rot += l.rotSpeed;
            l.vy += Math.sin(this.frame * 0.05 + l.x * 0.01) * 0.05;
            
            if (l.x > this.width + 10) { l.x = -10; l.y = Math.random() * this.height * 0.7; }
            if (l.y > this.groundY) { l.y = 0; l.x = Math.random() * this.width; }
            
            ctx.save();
            ctx.translate(l.x, l.y);
            ctx.rotate(l.rot);
            ctx.fillStyle = l.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, l.size, l.size * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }
    
    _drawDust() {
        if (!this.particles.dust.length) return;
        const ctx = this.ctx;
        this.particles.dust.forEach(d => {
            d.x += d.vx;
            if (d.x > this.width + 5) d.x = -5;
            ctx.fillStyle = `rgba(220, 200, 160, ${d.opacity})`;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    _drawLightning() {
        const ctx = this.ctx;
        // Random lightning
        if (!this.lightning.active && Math.random() < 0.005) {
            this.lightning.active = true;
            this.lightning.flash = 1;
            this.lightning.next = 5 + Math.random() * 8;
            this.lightning.path = this._generateLightningPath();
        }
        
        if (this.lightning.active) {
            // Full-screen flash
            ctx.fillStyle = `rgba(255, 255, 255, ${this.lightning.flash * 0.5})`;
            ctx.fillRect(0, 0, this.width, this.height);
            
            // Bolt
            if (this.lightning.flash > 0.6 && this.lightning.path) {
                ctx.save();
                ctx.strokeStyle = `rgba(255, 255, 255, ${this.lightning.flash})`;
                ctx.lineWidth = 3;
                ctx.shadowColor = 'rgba(200, 220, 255, 1)';
                ctx.shadowBlur = 20;
                ctx.beginPath();
                ctx.moveTo(this.lightning.path[0].x, this.lightning.path[0].y);
                for (let i = 1; i < this.lightning.path.length; i++) {
                    ctx.lineTo(this.lightning.path[i].x, this.lightning.path[i].y);
                }
                ctx.stroke();
                ctx.restore();
            }
            
            this.lightning.flash -= 0.05;
            if (this.lightning.flash <= 0) {
                this.lightning.active = false;
            }
        }
    }
    
    _generateLightningPath() {
        const path = [];
        let x = this.width * (0.2 + Math.random() * 0.6);
        let y = 0;
        const targetY = this.groundY;
        while (y < targetY) {
            path.push({ x, y });
            x += (Math.random() - 0.5) * 40;
            y += 20 + Math.random() * 30;
        }
        path.push({ x, y: targetY });
        return path;
    }
    
    _drawHeatShimmer() {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 0.08;
        for (let i = 0; i < 5; i++) {
            const offsetY = this.groundY - 40 - i * 15;
            const wobble = Math.sin(this.frame * 0.05 + i) * 3;
            ctx.strokeStyle = 'rgba(255, 200, 100, 1)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let x = 0; x < this.width; x += 20) {
                const y = offsetY + Math.sin(x * 0.05 + this.frame * 0.1) * wobble;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.restore();
    }
    
    // ---------- LIFECYCLE ----------
    
    destroy() {
        this.stop();
        window.removeEventListener('resize', this._boundResize);
    }
}

// Singleton helper
let _instance = null;
export function getWeatherScene(canvas) {
    if (!_instance && canvas) {
        _instance = new WeatherScene(canvas);
    }
    return _instance;
}
