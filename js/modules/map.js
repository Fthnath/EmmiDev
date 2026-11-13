import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { Toast } from '../ui/toast.js';
import { formatLocationLabel } from './locations.js';

class WeatherMapModule {
    constructor() {
        this.map = null;
        this.streetLayer = null;
        this.satelliteLayer = null;
        this.locationMarker = null;
        this.accuracyCircle = null;
        this.radarLayers = [];
        this.radarFrames = [];
        this.radarHost = null;
        this.currentFrameIndex = 0;
        this.playbackTimer = null;
        this.playbackSpeed = 1;
        this.isPlaying = false;
        this.activeLayer = null;
        this.layerLayers = {};
        this.weatherOverlayRequestId = 0;
        this.weatherOverlayRefreshTimer = null;
        this.location = null;
        this.initialized = false;
        this.pendingClickHandler = null;

        // Tracking state
        this.tracking = {
            active: false,
            watchId: null,
            points: [],
            polyline: null,
            arrowMarkers: [],
            startMarker: null,
            endMarker: null,
            heatVisible: false,
            heatCanvas: null,
            maxPoints: 500,
            minDistanceMeters: 8,
            trailKey: 'emmidev::trail::'
        };

        // Compass state
        this.compassEl = null;
        this.compassRotation = 0;

        // Nearest rain state
        this.nearestRain = {
            enabled: true,
            scanning: false,
            lastScan: 0,
            scanInterval: 90 * 1000,
            timer: null,
            arrowMarker: null,
            line: null,
            canvas: null,
            tileCache: new Map(),
            maxScanRadiusKm: 150,
            scanResolution: 32,
            // NEW: multi-direction
            multiCells: [],
            // NEW: prediction dots
            predDots: [],
            predTimer: null,
            // NEW: sound + notification
            soundEnabled: false,
            notifyEnabled: false,
            alertDistanceKm: 5,
            lastAlertTime: 0,
            alertCooldownMs: 15 * 60 * 1000,  // 15 min between alerts
            audioCtx: null,
            audioBuffer: null
        };
    }

    /* ============================================================
       INIT
       ============================================================ */
    init(location) {
        if (this.initialized) {
            this.setLocation(location);
            return;
        }

        const container = document.getElementById('weather-radar-map');
        if (!container) {
            console.warn('[WeatherMap] #weather-radar-map not found');
            return;
        }

        const leaflet = window.L;
        if (!leaflet) {
            console.error('[WeatherMap] Leaflet not loaded');
            this.showStatus('Map library could not load.');
            return;
        }

        this.location = this.validLocation(location) ? location : CONFIG.DEFAULT_LOCATION;
        const initialZoom = this.location.precise ? 16 : 10;

        this.map = leaflet.map(container, {
            zoomControl: false,
            preferCanvas: true,
            minZoom: 2,
            maxZoom: 19,
            worldCopyJump: true,
            tap: true,
            rotate: true,
            touchRotate: true
        }).setView([this.location.lat, this.location.lon], initialZoom);

        this.streetLayer = leaflet.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { maxZoom: 19, attribution: '&copy; OpenStreetMap' }
        );
        this.satelliteLayer = leaflet.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19, attribution: '&copy; Esri' }
        );
        this.streetLayer.addTo(this.map);

        this.createLocationMarker();

        leaflet.control.zoom({ position: 'bottomright' }).addTo(this.map);
        leaflet.control.scale({ position: 'bottomleft', imperial: false }).addTo(this.map);

        // Bind all UI
        this.bindLayerButtons();
        this.bindBasemapToggle();
        this.bindTimelineControls();
        this.bindRecenterButton();
        this.bindMapClickInspect();
        this.bindTrackingControls();
        this.bindTrailHeatToggle();
        this.initCompass();
        this.bindNearestRainToggle();
        this.bindRainAlertControls();   // NEW: sound + notification toggles
        this.loadRainAlertSettings();   // NEW: restore from Storage

        this.map.on('moveend zoomend', () => {
            this.scheduleWeatherOverlayRefresh();
            this.updateCompassRotation();
            if (this.nearestRain.predDots.length > 0) this.redrawPredictionDots();
        });
        this.map.on('rotate', () => this.updateCompassRotation());

        this.initialized = true;
        this.restoreSavedTrail();
        this.loadRainRadar();

        const precipBtn = document.querySelector('.map-layer-btn[data-layer="precip"]');
        if (precipBtn) {
            this.activeLayer = 'precip';
            precipBtn.classList.add('active');
        }
    }

    /* ============================================================
       COMPASS
       ============================================================ */
    initCompass() {
        this.compassEl = document.getElementById('mapCompass');
        if (!this.compassEl) return;
        this.compassEl.style.pointerEvents = 'auto';
        this.compassEl.style.cursor = 'pointer';
        this.compassEl.addEventListener('click', () => {
            if (this.map && typeof this.map.setBearing === 'function') {
                this.map.setBearing(0, { animate: true });
            } else {
                this.map.setView(this.map.getCenter(), this.map.getZoom(), { animate: true });
            }
        });
        this.updateCompassRotation();
    }

    updateCompassRotation() {
        if (!this.compassEl || !this.map) return;
        const bearing = (typeof this.map.getBearing === 'function') ? this.map.getBearing() : 0;
        const dial = this.compassEl.querySelector('.compass-dial');
        if (dial) dial.style.transform = `rotate(${-bearing}deg)`;
    }

    /* ============================================================
       TRACKING
       ============================================================ */
    bindTrackingControls() {
        const toggleBtn = document.getElementById('mapTrackToggle');
        if (!toggleBtn) return;
        toggleBtn.addEventListener('click', () => {
            if (this.tracking.active) this.stopTracking();
            else this.startTracking();
        });
    }

    startTracking() {
        if (!('geolocation' in navigator)) {
            this.showStatus('Geolocation is not supported by this browser.');
            return;
        }
        if (!this.map) return;

        this.clearTrail();
        this.tracking.active = true;
        this.tracking.points = [];

        const toggleBtn = document.getElementById('mapTrackToggle');
        toggleBtn?.classList.add('is-tracking');
        if (toggleBtn) {
            const span = toggleBtn.querySelector('span');
            if (span) span.textContent = 'Stop';
        }

        const indicator = document.getElementById('mapTrackIndicator');
        if (indicator) indicator.hidden = false;

        this.tracking.watchId = navigator.geolocation.watchPosition(
            (pos) => this.handleTrackPosition(pos),
            (err) => {
                console.error('[WeatherMap] Tracking error:', err);
                this.showStatus(`Tracking error: ${err.message}`);
                this.stopTracking();
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 }
        );

        this.showStatus('Recording route…');
        setTimeout(() => this.hideStatus(), 2000);
    }

    stopTracking() {
        this.tracking.active = false;
        if (this.tracking.watchId != null) {
            navigator.geolocation.clearWatch(this.tracking.watchId);
            this.tracking.watchId = null;
        }
        const toggleBtn = document.getElementById('mapTrackToggle');
        toggleBtn?.classList.remove('is-tracking');
        if (toggleBtn) {
            const span = toggleBtn.querySelector('span');
            if (span) span.textContent = 'Track';
        }
        const indicator = document.getElementById('mapTrackIndicator');
        if (indicator) indicator.hidden = true;
        this.persistTrail();
        this.showStatus(`Route saved (${this.tracking.points.length} points).`);
        setTimeout(() => this.hideStatus(), 2500);
    }

    handleTrackPosition(pos) {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const now = Date.now();
        if (accuracy && accuracy > 100) return;

        const last = this.tracking.points[this.tracking.points.length - 1];
        if (last) {
            const dist = this.distanceMeters(last.lat, last.lng, lat, lng);
            if (dist < this.tracking.minDistanceMeters) return;
        }

        this.tracking.points.push({ lat, lng, time: now, accuracy });
        if (this.tracking.points.length > this.tracking.maxPoints) {
            this.tracking.points.shift();
        }

        const counter = document.getElementById('mapTrackPoints');
        if (counter) counter.textContent = `${this.tracking.points.length} pts`;

        this.drawTrail();

        if (this.tracking.points.length === 1) {
            this.map.flyTo([lat, lng], Math.max(this.map.getZoom(), 15), { duration: 1 });
        }
    }

    drawTrail() {
        if (!this.map) return;
        const leaflet = window.L;
        const pts = this.tracking.points;

        if (this.tracking.polyline) this.map.removeLayer(this.tracking.polyline);
        this.tracking.arrowMarkers.forEach(m => this.map.removeLayer(m));
        this.tracking.arrowMarkers = [];
        if (this.tracking.startMarker) this.map.removeLayer(this.tracking.startMarker);
        if (this.tracking.endMarker) this.map.removeLayer(this.tracking.endMarker);

        if (pts.length < 2) return;

        const latlngs = pts.map(p => [p.lat, p.lng]);

        this.tracking.polyline = leaflet.polyline(latlngs, {
            color: '#1a73e8', weight: 5, opacity: 0.9,
            lineCap: 'round', lineJoin: 'round'
        }).addTo(this.map);

        leaflet.polyline(latlngs, {
            color: '#ffffff', weight: 8, opacity: 0.35,
            lineCap: 'round', lineJoin: 'round', interactive: false
        }).addTo(this.map);

        this.tracking.startMarker = leaflet.marker(latlngs[0], {
            icon: leaflet.divIcon({
                className: 'trail-marker',
                html: '<div class="trail-marker-start"></div>',
                iconSize: [14, 14], iconAnchor: [7, 7]
            }),
            interactive: false
        }).addTo(this.map);

        this.tracking.endMarker = leaflet.marker(latlngs[latlngs.length - 1], {
            icon: leaflet.divIcon({
                className: 'trail-marker',
                html: '<div class="trail-marker-end"></div>',
                iconSize: [14, 14], iconAnchor: [7, 7]
            }),
            interactive: false
        }).addTo(this.map);

        this.addDirectionArrows(pts);
    }

    addDirectionArrows(pts) {
        if (!this.map || pts.length < 2) return;
        const leaflet = window.L;
        const step = Math.max(3, Math.floor(pts.length / 12));
        let accumulatedDistance = 0;
        const arrowInterval = 100;

        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            accumulatedDistance += this.distanceMeters(a.lat, a.lng, b.lat, b.lng);

            if (accumulatedDistance >= arrowInterval || i % step === 0) {
                accumulatedDistance = 0;
                const angle = this.bearingBetween(a.lat, a.lng, b.lat, b.lng);
                const marker = leaflet.marker([b.lat, b.lng], {
                    icon: leaflet.divIcon({
                        className: 'trail-arrow',
                        html: `<span style="transform: rotate(${angle}deg);"></span>`,
                        iconSize: [10, 10], iconAnchor: [5, 5]
                    }),
                    interactive: false, zIndexOffset: 100
                }).addTo(this.map);
                this.tracking.arrowMarkers.push(marker);
            }
        }
    }

    clearTrail() {
        if (!this.map) return;
        if (this.tracking.polyline) this.map.removeLayer(this.tracking.polyline);
        this.tracking.arrowMarkers.forEach(m => this.map.removeLayer(m));
        this.tracking.arrowMarkers = [];
        if (this.tracking.startMarker) this.map.removeLayer(this.tracking.startMarker);
        if (this.tracking.endMarker) this.map.removeLayer(this.tracking.endMarker);
        this.tracking.polyline = null;
        this.tracking.startMarker = null;
        this.tracking.endMarker = null;
        this.tracking.points = [];
        this.hideTrailHeat();
    }

    bindTrailHeatToggle() {
        const btn = document.getElementById('mapTrailHeatBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (this.tracking.heatVisible) {
                this.hideTrailHeat();
                btn.classList.remove('active');
            } else {
                this.showTrailHeat();
                btn.classList.add('active');
            }
        });
    }

    showTrailHeat() {
        const pts = this.tracking.points;
        if (!this.map || pts.length < 2) {
            this.showStatus('Track a route first to see your trail heatmap.');
            setTimeout(() => this.hideStatus(), 2500);
            return;
        }
        const shell = document.getElementById('weatherMapShell');
        if (!shell) return;

        let canvas = shell.querySelector('.trail-heat-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'trail-heat-canvas';
            shell.appendChild(canvas);
        }

        const size = this.map.getSize();
        canvas.width = size.x;
        canvas.height = size.y;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const p of pts) {
            const containerPoint = this.map.latLngToContainerPoint([p.lat, p.lng]);
            const gradient = ctx.createRadialGradient(
                containerPoint.x, containerPoint.y, 0,
                containerPoint.x, containerPoint.y, 30
            );
            gradient.addColorStop(0, 'rgba(26, 115, 232, 0.55)');
            gradient.addColorStop(1, 'rgba(26, 115, 232, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(containerPoint.x, containerPoint.y, 30, 0, Math.PI * 2);
            ctx.fill();
        }

        canvas.classList.add('is-visible');
        this.tracking.heatVisible = true;
        this.tracking.heatCanvas = canvas;

        if (!this._heatMoveHandler) {
            this._heatMoveHandler = () => {
                if (this.tracking.heatVisible) this.showTrailHeat();
            };
            this.map.on('move zoom moveend zoomend', this._heatMoveHandler);
        }
    }

    hideTrailHeat() {
        const shell = document.getElementById('weatherMapShell');
        if (!shell) return;
        const canvas = shell.querySelector('.trail-heat-canvas');
        if (canvas) {
            canvas.classList.remove('is-visible');
            setTimeout(() => canvas.remove(), 400);
        }
        this.tracking.heatVisible = false;
        this.tracking.heatCanvas = null;
        if (this._heatMoveHandler && this.map) {
            this.map.off('move zoom moveend zoomend', this._heatMoveHandler);
            this._heatMoveHandler = null;
        }
    }

    persistTrail() {
        const pts = this.tracking.points;
        if (pts.length < 2) return;
        Storage.set(this.tracking.trailKey + 'last', {
            points: pts.slice(-200),
            savedAt: Date.now()
        });
    }

    restoreSavedTrail() {
        const saved = Storage.get(this.tracking.trailKey + 'last', null);
        if (!saved || !Array.isArray(saved.points) || saved.points.length < 2) return;
        if (Date.now() - saved.savedAt > 24 * 60 * 60 * 1000) return;

        this.tracking.points = saved.points;
        this.drawTrail();

        const indicator = document.getElementById('mapTrackIndicator');
        const counter = document.getElementById('mapTrackPoints');
        if (indicator) indicator.hidden = false;
        if (counter) counter.textContent = `${saved.points.length} pts`;

        this.showStatus('Previous route restored. Tap "Track" to start a new one.');
        setTimeout(() => this.hideStatus(), 3500);
    }

    /* ============================================================
       GEOMETRY
       ============================================================ */
    distanceMeters(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const toRad = d => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    bearingBetween(lat1, lng1, lat2, lng2) {
        const toRad = d => (d * Math.PI) / 180;
        const toDeg = r => (r * 180) / Math.PI;
        const dLng = toRad(lng2 - lng1);
        const y = Math.sin(dLng) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
                  Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    /* ============================================================
       NEW: RAIN ALERT CONTROLS (sound + notification)
       ============================================================ */
    bindRainAlertControls() {
        const soundBtn = document.getElementById('rainSoundToggle');
        const notifyBtn = document.getElementById('rainNotifyToggle');

        if (soundBtn) {
            soundBtn.addEventListener('click', async () => {
                this.nearestRain.soundEnabled = !this.nearestRain.soundEnabled;
                soundBtn.setAttribute('aria-pressed', String(this.nearestRain.soundEnabled));
                soundBtn.innerHTML = this.nearestRain.soundEnabled
                    ? '<i class="fas fa-volume-high"></i><span>Sound</span>'
                    : '<i class="fas fa-volume-xmark"></i><span>Sound</span>';
                Storage.set('emmidev::rainSound', this.nearestRain.soundEnabled);
                if (this.nearestRain.soundEnabled) {
                    await this.initAudio();
                    this.playChime(0.3); // preview
                }
            });
        }

        if (notifyBtn) {
            notifyBtn.addEventListener('click', async () => {
                if (!('Notification' in window)) {
                    Toast.error('Notifications not supported');
                    return;
                }

                if (!this.nearestRain.notifyEnabled) {
                    const perm = await Notification.requestPermission();
                    if (perm !== 'granted') {
                        Toast.warning('Notification permission denied');
                        return;
                    }
                    this.nearestRain.notifyEnabled = true;
                    notifyBtn.setAttribute('aria-pressed', 'true');
                    notifyBtn.innerHTML = '<i class="fas fa-bell"></i><span>Notify</span>';
                } else {
                    this.nearestRain.notifyEnabled = false;
                    notifyBtn.setAttribute('aria-pressed', 'false');
                    notifyBtn.innerHTML = '<i class="fas fa-bell-slash"></i><span>Notify</span>';
                }
                Storage.set('emmidev::rainNotify', this.nearestRain.notifyEnabled);
            });
        }
    }

    loadRainAlertSettings() {
        const sound = Storage.get('emmidev::rainSound', false);
        const notify = Storage.get('emmidev::rainNotify', false);
        const dist = Storage.get('emmidev::rainAlertDist', 5);

        this.nearestRain.soundEnabled = !!sound;
        this.nearestRain.notifyEnabled = !!notify && Notification?.permission === 'granted';
        this.nearestRain.alertDistanceKm = Number(dist) || 5;

        const soundBtn = document.getElementById('rainSoundToggle');
        if (soundBtn) {
            soundBtn.setAttribute('aria-pressed', String(this.nearestRain.soundEnabled));
            soundBtn.innerHTML = this.nearestRain.soundEnabled
                ? '<i class="fas fa-volume-high"></i><span>Sound</span>'
                : '<i class="fas fa-volume-xmark"></i><span>Sound</span>';
        }

        const notifyBtn = document.getElementById('rainNotifyToggle');
        if (notifyBtn) {
            notifyBtn.setAttribute('aria-pressed', String(this.nearestRain.notifyEnabled));
            notifyBtn.innerHTML = this.nearestRain.notifyEnabled
                ? '<i class="fas fa-bell"></i><span>Notify</span>'
                : '<i class="fas fa-bell-slash"></i><span>Notify</span>';
        }

        const distInput = document.getElementById('rainAlertDistance');
        if (distInput) distInput.value = this.nearestRain.alertDistanceKm;
    }

    async initAudio() {
        if (this.nearestRain.audioCtx) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            this.nearestRain.audioCtx = new AudioCtx();
            // Generate a soft two-tone chime buffer
            const duration = 0.4;
            const sampleRate = this.nearestRain.audioCtx.sampleRate;
            const buffer = this.nearestRain.audioCtx.createBuffer(1, sampleRate * duration, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                const t = i / sampleRate;
                const env = Math.exp(-t * 8);
                data[i] = (Math.sin(2 * Math.PI * 880 * t) * 0.5 +
                          Math.sin(2 * Math.PI * 1320 * t) * 0.3) * env * 0.6;
            }
            this.nearestRain.audioBuffer = buffer;
        } catch (err) {
            console.warn('[WeatherMap] Audio init failed:', err);
        }
    }

    playChime(volume = 0.5) {
        const ctx = this.nearestRain.audioCtx;
        const buffer = this.nearestRain.audioBuffer;
        if (!ctx || !buffer) return;
        try {
            if (ctx.state === 'suspended') ctx.resume();
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            const gain = ctx.createGain();
            gain.gain.value = volume;
            source.connect(gain);
            gain.connect(ctx.destination);
            source.start(0);
        } catch (err) {
            console.warn('[WeatherMap] Chime play failed:', err);
        }
    }

    maybeAlertRain(nearest) {
        const distKm = nearest.distanceM / 1000;
        if (distKm > this.nearestRain.alertDistanceKm) return;

        const now = Date.now();
        if (now - this.nearestRain.lastAlertTime < this.nearestRain.alertCooldownMs) return;

        this.nearestRain.lastAlertTime = now;

        const dir = this.compassDirection(nearest.bearing);
        const message = `Rain within ${distKm.toFixed(1)} km ${dir}`;

        if (this.nearestRain.soundEnabled) {
            this.playChime(0.6);
        }
        if (this.nearestRain.notifyEnabled && Notification?.permission === 'granted') {
            try {
                new Notification('EmmiDev Weather', {
                    body: `${message} — grab an umbrella`,
                    icon: '/weather-icon.svg',
                    tag: 'rain-alert',
                    renotify: true
                });
            } catch (err) {
                console.warn('[WeatherMap] Notification failed:', err);
            }
        }
        this.showRainAlertToast(message);
    }

    showRainAlertToast(message) {
        let toast = document.querySelector('.rain-alert-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'rain-alert-toast';
            toast.innerHTML = `<i class="fas fa-cloud-rain"></i><span></span>`;
            document.body.appendChild(toast);
        }
        toast.querySelector('span').textContent = message;
        requestAnimationFrame(() => toast.classList.add('is-visible'));
        clearTimeout(this._rainToastTimer);
        this._rainToastTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 6000);
    }

    /* ============================================================
       NEAREST RAIN
       ============================================================ */
    bindNearestRainToggle() {
        const btn = document.getElementById('mapNearestRainBtn');
        const dismiss = document.getElementById('nearestRainDismiss');
        const multiDismiss = document.getElementById('multiRainDismiss');

        if (btn) {
            btn.addEventListener('click', () => {
                this.nearestRain.enabled = !this.nearestRain.enabled;
                btn.classList.toggle('active', this.nearestRain.enabled);
                if (this.nearestRain.enabled) {
                    this.scanNearestRain();
                    this.startNearestRainTimer();
                } else {
                    this.stopNearestRainTimer();
                    this.clearNearestRain();
                    this.hideMultiRain();
                    this.clearPredictionDots();
                }
            });
        }

        if (dismiss) {
            dismiss.addEventListener('click', () => {
                const badge = document.getElementById('nearestRainBadge');
                if (badge) badge.hidden = true;
            });
        }

        if (multiDismiss) {
            multiDismiss.addEventListener('click', () => this.hideMultiRain());
        }

        if (this.radarFrames.length > 0) {
            this.scanNearestRain();
            this.startNearestRainTimer();
        }
    }

    startNearestRainTimer() {
        if (this.nearestRain.timer) clearInterval(this.nearestRain.timer);
        this.nearestRain.timer = setInterval(() => {
            if (this.nearestRain.enabled) this.scanNearestRain();
        }, this.nearestRain.scanInterval);
    }

    stopNearestRainTimer() {
        if (this.nearestRain.timer) clearInterval(this.nearestRain.timer);
        this.nearestRain.timer = null;
    }

    async scanNearestRain() {
        if (!this.map || !this.location) return;
        if (this.nearestRain.scanning) return;
        if (this.radarFrames.length === 0) return;

        this.nearestRain.scanning = true;

        try {
            const frame = this.getLatestObservedFrame();
            if (!frame) {
                this.hideNearestRain('No radar data available');
                return;
            }

            const centerLat = this.location.lat;
            const centerLng = this.location.lon;
            const zoom = 8;
            const centerTile = this.latLngToTile(centerLat, centerLng, zoom);
            const gridRadius = 3;
            const tiles = [];
            for (let dx = -gridRadius; dx <= gridRadius; dx++) {
                for (let dy = -gridRadius; dy <= gridRadius; dy++) {
                    tiles.push({
                        x: centerTile.x + dx,
                        y: centerTile.y + dy,
                        z: zoom, dx, dy
                    });
                }
            }

            const tileData = await Promise.all(
                tiles.map(t => this.fetchRadarTile(frame, t).catch(() => null))
            );

            // Collect ALL rain cells (not just nearest)
            const cells = [];
            for (let i = 0; i < tileData.length; i++) {
                const data = tileData[i];
                if (!data || !data.hasRain) continue;
                const results = this.findAllRainCells(data, tiles[i], centerLat, centerLng);
                cells.push(...results);
            }

            // Sort by distance
            cells.sort((a, b) => a.distanceM - b.distanceM);

            // Deduplicate nearby cells (merge cells within 5 km)
            const merged = this.mergeNearbyCells(cells, 5000);

            this.nearestRain.multiCells = merged.slice(0, 2);

            if (merged.length > 0 && merged[0].distanceM < this.nearestRain.maxScanRadiusKm * 1000) {
                this.showNearestRain(merged[0]);
                this.showMultiRain(merged.slice(0, 2));
                this.drawPredictionDots(merged[0]);
                this.maybeAlertRain(merged[0]);
            } else {
                this.hideNearestRain('No rain within 150 km', 'dry');
                this.hideMultiRain();
                this.clearPredictionDots();
            }

            this.nearestRain.lastScan = Date.now();
        } catch (err) {
            console.warn('[WeatherMap] Nearest rain scan failed:', err);
            this.hideNearestRain('Rain scan unavailable');
        } finally {
            this.nearestRain.scanning = false;
        }
    }

    getLatestObservedFrame() {
        if (!this.radarFrames.length) return null;
        const now = Date.now() / 1000;
        for (let i = this.radarFrames.length - 1; i >= 0; i--) {
            if (this.radarFrames[i].time <= now) return this.radarFrames[i];
        }
        return this.radarFrames[0];
    }

    async fetchRadarTile(frame, tile) {
        const maxTile = Math.pow(2, tile.z);
        const tx = ((tile.x % maxTile) + maxTile) % maxTile;
        const ty = Math.max(0, Math.min(maxTile - 1, tile.y));

        const cacheKey = `${frame.path}::${tile.z}/${tx}/${ty}`;
        if (this.nearestRain.tileCache.has(cacheKey)) {
            return this.nearestRain.tileCache.get(cacheKey);
        }

        const url = `${this.radarHost}${frame.path}/256/${tile.z}/${tx}/${ty}/4/1_1.png`;

        try {
            const res = await fetch(url, { cache: 'force-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const bitmap = await createImageBitmap(blob);

            const size = this.nearestRain.scanResolution;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0, size, size);
            const pixels = ctx.getImageData(0, 0, size, size).data;

            let hasRain = false;
            for (let p = 0; p < pixels.length; p += 4) {
                if (pixels[p + 3] > 40) { hasRain = true; break; }
            }

            const data = { pixels, size, hasRain };
            this.nearestRain.tileCache.set(cacheKey, data);
            if (this.nearestRain.tileCache.size > 50) {
                const firstKey = this.nearestRain.tileCache.keys().next().value;
                this.nearestRain.tileCache.delete(firstKey);
            }
            return data;
        } catch (err) {
            return null;
        }
    }

    findAllRainCells(tileData, tile, centerLat, centerLng) {
        const { pixels, size } = tileData;
        if (!pixels || size === 0) return [];

        const tileBounds = this.tileToBounds(tile.x, tile.y, tile.z);
        const cells = [];

        // Sample every 4th pixel to speed up scanning
        const stride = 4;
        for (let py = 0; py < size; py += stride) {
            for (let px = 0; px < size; px += stride) {
                const idx = (py * size + px) * 4;
                const alpha = pixels[idx + 3];
                if (alpha < 40) continue;

                const fx = px / size;
                const fy = py / size;
                const lng = tileBounds.west + (tileBounds.east - tileBounds.west) * fx;
                const lat = tileBounds.north - (tileBounds.north - tileBounds.south) * fy;

                const distM = this.distanceMeters(centerLat, centerLng, lat, lng);
                cells.push({
                    lat, lng,
                    distanceM: distM,
                    bearing: this.bearingBetween(centerLat, centerLng, lat, lng),
                    intensity: alpha / 255
                });
            }
        }
        return cells;
    }

    mergeNearbyCells(cells, mergeRadiusM) {
        if (cells.length === 0) return [];
        const merged = [];
        const used = new Set();

        for (let i = 0; i < cells.length; i++) {
            if (used.has(i)) continue;
            const base = cells[i];
            const group = [base];
            used.add(i);

            for (let j = i + 1; j < cells.length; j++) {
                if (used.has(j)) continue;
                if (this.distanceMeters(base.lat, base.lng, cells[j].lat, cells[j].lng) < mergeRadiusM) {
                    group.push(cells[j]);
                    used.add(j);
                }
            }

            // Average the group
            const avgLat = group.reduce((s, c) => s + c.lat, 0) / group.length;
            const avgLng = group.reduce((s, c) => s + c.lng, 0) / group.length;
            const minDist = Math.min(...group.map(c => c.distanceM));
            const avgIntensity = group.reduce((s, c) => s + c.intensity, 0) / group.length;

            merged.push({
                lat: avgLat,
                lng: avgLng,
                distanceM: minDist,
                bearing: this.bearingBetween(
                    this.location.lat, this.location.lon, avgLat, avgLng
                ),
                intensity: avgIntensity
            });
        }

        return merged.sort((a, b) => a.distanceM - b.distanceM);
    }

    /* ============================================================
       NEW: PREDICTION DOTS (animated rain approach)
       ============================================================ */
    drawPredictionDots(nearest) {
        this.clearPredictionDots();
        if (!this.map || !nearest) return;
        const leaflet = window.L;

        // Estimate rain motion: assume it moves toward user at ~40 km/h
        // Place dots at 5, 10, 15 min intervals along bearing line
        const speedKmh = 40;
        const speedMs = speedKmh * 1000 / 3600;

        const intervals = [5, 10, 15];
        intervals.forEach(min => {
            const seconds = min * 60;
            const traveledM = speedMs * seconds;
            // Distance from current rain position toward user
            const remaining = Math.max(0, nearest.distanceM - traveledM);
            const fraction = remaining / nearest.distanceM;

            const dotLat = nearest.lat + (this.location.lat - nearest.lat) * (1 - fraction);
            const dotLng = nearest.lng + (this.location.lon - nearest.lng) * (1 - fraction);

            const icon = leaflet.divIcon({
                className: `rain-pred-dot min-${min}`,
                html: `<span></span><div class="rain-pred-label">${min} min</div>`,
                iconSize: [10, 10],
                iconAnchor: [5, 5]
            });

            const marker = leaflet.marker([dotLat, dotLng], {
                icon, interactive: false, zIndexOffset: 450
            }).addTo(this.map);

            this.nearestRain.predDots.push(marker);
        });

        // Also add a "now" dot at the rain cell center
        const nowIcon = leaflet.divIcon({
            className: 'rain-pred-dot min-5',
            html: `<span></span><div class="rain-pred-label">Rain</div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });
        const nowMarker = leaflet.marker([nearest.lat, nearest.lng], {
            icon: nowIcon, interactive: false, zIndexOffset: 460
        }).addTo(this.map);
        this.nearestRain.predDots.push(nowMarker);
    }

    redrawPredictionDots() {
        if (this.nearestRain.multiCells.length > 0) {
            this.drawPredictionDots(this.nearestRain.multiCells[0]);
        }
    }

    clearPredictionDots() {
        if (!this.map) return;
        this.nearestRain.predDots.forEach(m => this.map.removeLayer(m));
        this.nearestRain.predDots = [];
    }

    /* ============================================================
       NEW: MULTI-DIRECTION DISPLAY
       ============================================================ */
    showMultiRain(cells) {
        if (!cells || cells.length < 2) {
            this.hideMultiRain();
            return;
        }

        const badge = document.getElementById('multiRainBadge');
        const cellsEl = document.getElementById('multiRainCells');
        if (!badge || !cellsEl) return;

        cellsEl.innerHTML = cells.map((cell, idx) => {
            const distKm = cell.distanceM / 1000;
            const dir = this.compassDirection(cell.bearing);
            const eta = this.estimateRainArrival(cell.distanceM);
            const intensityLabel = cell.intensity > 0.6 ? 'Heavy' :
                                   cell.intensity > 0.3 ? 'Moderate' : 'Light';
            return `
                <div class="multi-rain-cell">
                    <span class="multi-rain-cell-dir">${dir}</span>
                    <div class="multi-rain-cell-info">
                        <strong>${distKm.toFixed(1)} km</strong>
                        <span>${intensityLabel}${eta ? ` · ~${eta}` : ''}</span>
                    </div>
                </div>
            `;
        }).join('');

        badge.hidden = false;
    }

    hideMultiRain() {
        const badge = document.getElementById('multiRainBadge');
        if (badge) badge.hidden = true;
    }

    /* ============================================================
       NEAREST RAIN DISPLAY (single, primary)
       ============================================================ */
    showNearestRain(nearest) {
        const badge = document.getElementById('nearestRainBadge');
        const text = document.getElementById('nearestRainText');
        if (!badge || !text) return;

        const distKm = nearest.distanceM / 1000;
        const dir = this.compassDirection(nearest.bearing);
        const eta = this.estimateRainArrival(nearest.distanceM);

        let label;
        if (distKm < 2) {
            label = `Rain overhead (${dir})`;
            badge.classList.add('is-near');
        } else if (distKm < 15) {
            label = `${distKm.toFixed(1)} km ${dir}${eta ? ` · ~${eta}` : ''}`;
            badge.classList.add('is-near');
        } else {
            label = `${distKm.toFixed(0)} km ${dir}${eta ? ` · ~${eta}` : ''}`;
            badge.classList.remove('is-near');
        }

        badge.classList.remove('is-dry', 'is-far');
        if (distKm >= 15) badge.classList.add('is-far');

        text.textContent = label;
        badge.hidden = false;

        this.drawNearestRainArrow(nearest);
    }

    hideNearestRain(message, mode = 'dry') {
        const badge = document.getElementById('nearestRainBadge');
        const text = document.getElementById('nearestRainText');
        if (badge && text && message) {
            text.textContent = message;
            badge.classList.remove('is-near', 'is-far');
            badge.classList.add(`is-${mode}`);
            badge.hidden = false;
        } else if (badge) {
            badge.hidden = true;
        }
        this.clearNearestRainArrow();
    }

    clearNearestRain() {
        this.hideNearestRain('Scanning…', 'far');
        this.clearNearestRainArrow();
    }

    drawNearestRainArrow(nearest) {
        if (!this.map) return;
        this.clearNearestRainArrow();
        const leaflet = window.L;

        const midLat = (this.location.lat + nearest.lat) / 2;
        const midLng = (this.location.lon + nearest.lng) / 2;

        const icon = leaflet.divIcon({
            className: 'nearest-rain-arrow',
            html: `<span style="transform: rotate(${nearest.bearing}deg);"></span>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        this.nearestRain.arrowMarker = leaflet.marker([midLat, midLng], {
            icon, interactive: false, zIndexOffset: 400
        }).addTo(this.map);

        if (!this.nearestRain.line) {
            this.nearestRain.line = leaflet.polyline(
                [[this.location.lat, this.location.lon], [nearest.lat, nearest.lng]],
                {
                    color: '#dc2626', weight: 2, opacity: 0.5,
                    dashArray: '6, 8', interactive: false
                }
            ).addTo(this.map);
        } else {
            this.nearestRain.line.setLatLngs([
                [this.location.lat, this.location.lon],
                [nearest.lat, nearest.lng]
            ]);
        }
    }

    clearNearestRainArrow() {
        if (!this.map) return;
        if (this.nearestRain.arrowMarker) {
            this.map.removeLayer(this.nearestRain.arrowMarker);
            this.nearestRain.arrowMarker = null;
        }
        if (this.nearestRain.line) {
            this.map.removeLayer(this.nearestRain.line);
            this.nearestRain.line = null;
        }
    }

    compassDirection(bearingDeg) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const idx = Math.round(bearingDeg / 45) % 8;
        return dirs[idx];
    }

    estimateRainArrival(distanceM) {
        const speedMs = 11;
        const seconds = distanceM / speedMs;
        if (seconds < 60) return '<1 min';
        if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
        return null;
    }

    /* ============================================================
       TILE MATH
       ============================================================ */
    latLngToTile(lat, lng, z) {
        const n = Math.pow(2, z);
        const x = Math.floor((lng + 180) / 360 * n);
        const latRad = lat * Math.PI / 180;
        const y = Math.floor(
            (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
        );
        return { x, y, z };
    }

    tileToBounds(x, y, z) {
        const n = Math.pow(2, z);
        const west  = x / n * 360 - 180;
        const east  = (x + 1) / n * 360 - 180;
        const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
        const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
        return { west, east, north, south };
    }

    /* ============================================================
       EXISTING: LOCATION MARKER, LAYERS, RADAR, ETC.
       ============================================================ */
    createLocationMarker() {
        const leaflet = window.L;
        const coords = [this.location.lat, this.location.lon];

        if (this.locationMarker) this.map.removeLayer(this.locationMarker);
        if (this.accuracyCircle) this.map.removeLayer(this.accuracyCircle);

        const pulseIcon = leaflet.divIcon({
            className: 'map-location-pulse',
            html: `<span class="map-location-ring"></span><span class="map-location-dot"></span>`,
            iconSize: [26, 26], iconAnchor: [13, 13]
        });

        this.locationMarker = leaflet.marker(coords, {
            icon: pulseIcon, zIndexOffset: 1000, interactive: true
        }).addTo(this.map);

        const popupHtml = `
            <div class="map-popup">
                <strong>${this.escapeHtml(formatLocationLabel(this.location) || 'My Location')}</strong>
                <div class="map-popup-coords">${this.location.lat.toFixed(5)}, ${this.location.lon.toFixed(5)}</div>
                ${this.location.accuracy ? `<div class="map-popup-acc">± ${Math.round(this.location.accuracy)} m accuracy</div>` : ''}
            </div>
        `;
        this.locationMarker.bindPopup(popupHtml);

        if (this.location.accuracy && this.location.accuracy < 5000) {
            this.accuracyCircle = leaflet.circle(coords, {
                radius: this.location.accuracy,
                color: '#1a73e8', fillColor: '#1a73e8',
                fillOpacity: 0.1, weight: 1.5, opacity: 0.5, interactive: false
            }).addTo(this.map);
        }
    }

    bindLayerButtons() {
        document.querySelectorAll('.map-layer-btn[data-layer]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleLayer(btn.dataset.layer, btn));
        });
    }

    toggleLayer(layerType, button) {
        if (!this.map) return;
        this.weatherOverlayRequestId++;
        const wasActive = button.classList.contains('active');

        document.querySelectorAll('.map-layer-btn[data-layer]').forEach(b => b.classList.remove('active'));
        Object.values(this.layerLayers).forEach(layer => {
            if (layer && this.map.hasLayer(layer)) this.map.removeLayer(layer);
        });
        if (this.radarLayers[this.currentFrameIndex] &&
            this.map.hasLayer(this.radarLayers[this.currentFrameIndex])) {
            this.map.removeLayer(this.radarLayers[this.currentFrameIndex]);
        }

        if (this.isPlaying) this.pausePlayback();
        this.hideTimeline();
        this.hideLegend();
        this.hideStatus();

        if (wasActive) { this.activeLayer = null; return; }

        button.classList.add('active');
        this.activeLayer = layerType;

        if (layerType === 'precip') this.activatePrecip(button);
        else this.activateWeatherLayer(layerType, button);
    }

    async activatePrecip(button) {
        if (this.radarLayers.length === 0) {
            button.classList.add('loading');
            await this.loadRainRadar();
            button.classList.remove('loading');
        }
        if (this.radarLayers.length === 0) {
            this.showStatus('Rain radar unavailable. Base map still works.');
            return;
        }
        this.currentFrameIndex = this.radarLayers.length - 1;
        this.radarLayers[this.currentFrameIndex].addTo(this.map);
        this.showTimeline();
        this.showLegend('precip');
        this.updateTimelineUI();
    }

    async loadRainRadar() {
        try {
            this.showStatus('Loading rain radar…');
            const res = await fetch(CONFIG.RAINVIEWER_API, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const past    = data?.radar?.past    || [];
            const nowcast = data?.radar?.nowcast || [];
            if (past.length === 0) throw new Error('No past radar frames');

            this.radarFrames = [...past, ...nowcast];
            this.radarHost = data.host;
            const leaflet = window.L;

            this.radarLayers = this.radarFrames.map(frame => {
                const url = `${this.radarHost}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`;
                return leaflet.tileLayer(url, {
                    opacity: 0.7, maxZoom: 19, maxNativeZoom: 10, tileSize: 256,
                    attribution: '&copy; <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>'
                });
            });

            this.hideStatus();

            if (this.activeLayer === 'precip') {
                this.currentFrameIndex = this.radarLayers.length - 1;
                this.radarLayers[this.currentFrameIndex].addTo(this.map);
                this.showTimeline();
                this.showLegend('precip');
                this.updateTimelineUI();
            }

            // NEW: kick off nearest rain once radar ready
            if (this.nearestRain.enabled) {
                this.scanNearestRain();
                this.startNearestRainTimer();
            }
        } catch (err) {
            console.error('[WeatherMap] Rain radar failed:', err);
            this.showStatus('Rain radar is unavailable. Base map still works.');
        }
    }

    async activateWeatherLayer(type, button) {
        const requestId = ++this.weatherOverlayRequestId;
        const labels = { temp: 'temperature', wind: 'wind', clouds: 'cloud' };
        const variable = labels[type];
        if (!variable) return;

        const previous = this.layerLayers[type];
        if (previous && this.map.hasLayer(previous)) this.map.removeLayer(previous);
        button.classList.add('loading');
        this.showStatus(`Loading ${variable} overlay…`);

        try {
            const size = this.map.getSize();
            if (!size.x || !size.y) throw new Error('Map is not visible yet');

            const columns = 8, rows = 8;
            const points = [];
            for (let row = 0; row < rows; row++) {
                for (let column = 0; column < columns; column++) {
                    const x = (column + 0.5) * size.x / columns;
                    const y = (row + 0.5) * size.y / rows;
                    points.push(this.map.containerPointToLatLng([x, y]));
                }
            }

            const params = new URLSearchParams({
                latitude: points.map(p => p.lat.toFixed(4)).join(','),
                longitude: points.map(p => p.lng.toFixed(4)).join(','),
                current: 'temperature_2m,wind_speed_10m,cloud_cover',
                timezone: 'auto'
            });
            const response = await fetch(`${CONFIG.OPEN_METEO_BASE}/forecast?${params}`);
            if (!response.ok) throw new Error(`Weather service returned HTTP ${response.status}`);
            const result = await response.json();
            const locations = Array.isArray(result) ? result : [result];
            if (locations.length !== points.length) throw new Error('Weather service returned incomplete map data');

            if (requestId !== this.weatherOverlayRequestId || this.activeLayer !== type) return;

            const valueKeys = { temp: 'temperature_2m', wind: 'wind_speed_10m', clouds: 'cloud_cover' };
            const values = locations.map(l => l?.current?.[valueKeys[type]]);
            if (!values.some(Number.isFinite)) throw new Error('Weather data is unavailable for this area');

            const spacing = Math.min(size.x / columns, size.y / rows);
            const layer = window.L.layerGroup();
            points.forEach((point, index) => {
                const value = values[index];
                if (!Number.isFinite(value)) return;
                window.L.circleMarker([point.lat, point.lng], {
                    radius: Math.max(12, Math.min(34, spacing * 0.78)),
                    stroke: false,
                    fillColor: this.weatherValueColor(type, value),
                    fillOpacity: 0.58,
                    interactive: false
                }).addTo(layer);
            });

            layer.addTo(this.map);
            this.layerLayers[type] = layer;
            this.hideStatus();
            this.showLegend(type, values.filter(Number.isFinite));
        } catch (err) {
            if (requestId === this.weatherOverlayRequestId && this.activeLayer === type) {
                console.error(`[WeatherMap] ${variable} overlay failed:`, err);
                button.classList.remove('active');
                this.activeLayer = null;
                this.hideLegend();
                this.showStatus(`${variable[0].toUpperCase()}${variable.slice(1)} overlay unavailable. Check your connection and try again.`);
            }
        } finally {
            button.classList.remove('loading');
        }
    }

    weatherValueColor(type, value) {
        const scales = {
            temp: { min: -5, max: 40, colors: ['#2563eb', '#22d3ee', '#22c55e', '#facc15', '#f97316', '#dc2626'] },
            wind: { min: 0, max: 80, colors: ['#e0f2fe', '#38bdf8', '#0ea5e9', '#7c3aed', '#4c1d95'] },
            clouds: { min: 0, max: 100, colors: ['#f8fafc', '#cbd5e1', '#64748b', '#1e293b'] }
        };
        const scale = scales[type];
        const position = Math.max(0, Math.min(1, (value - scale.min) / (scale.max - scale.min))) * (scale.colors.length - 1);
        const lower = Math.floor(position);
        const upper = Math.min(scale.colors.length - 1, lower + 1);
        const amount = position - lower;
        const channels = [1, 3, 5].map(index => {
            const start = parseInt(scale.colors[lower].slice(index, index + 2), 16);
            const end = parseInt(scale.colors[upper].slice(index, index + 2), 16);
            return Math.round(start + (end - start) * amount).toString(16).padStart(2, '0');
        });
        return `#${channels.join('')}`;
    }

    scheduleWeatherOverlayRefresh() {
        if (!['temp', 'wind', 'clouds'].includes(this.activeLayer)) return;
        clearTimeout(this.weatherOverlayRefreshTimer);
        this.weatherOverlayRefreshTimer = setTimeout(() => {
            const button = document.querySelector(`.map-layer-btn[data-layer="${this.activeLayer}"]`);
            if (button) this.activateWeatherLayer(this.activeLayer, button);
        }, 400);
    }

    bindBasemapToggle() {
        const btn = document.getElementById('mapBasemapToggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (!this.map) return;
            const isStreet = this.map.hasLayer(this.streetLayer);
            if (isStreet) {
                this.map.removeLayer(this.streetLayer);
                this.satelliteLayer.addTo(this.map);
                btn.dataset.mode = 'satellite';
                const label = btn.querySelector('span');
                if (label) label.textContent = 'Satellite';
            } else {
                this.map.removeLayer(this.satelliteLayer);
                this.streetLayer.addTo(this.map);
                btn.dataset.mode = 'street';
                const label = btn.querySelector('span');
                if (label) label.textContent = 'Street';
            }
        });
    }

    bindRecenterButton() {
        const btn = document.getElementById('mapRecenterBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (!this.map || !this.location) return;
            const zoom = this.location.precise ? 16 : 11;
            this.map.flyTo([this.location.lat, this.location.lon], zoom, { duration: 1.4 });
            if (this.locationMarker) this.locationMarker.openPopup();
        });
    }

    bindMapClickInspect() {
        if (!this.map) return;
        this.map.on('click', async (e) => {
            const { lat, lng } = e.latlng;
            const popup = window.L.popup({
                className: 'map-inspect-popup', maxWidth: 280, closeButton: true
            })
            .setLatLng([lat, lng])
            .setContent(`
                <div class="map-inspect">
                    <div class="map-inspect-title">Checking weather…</div>
                    <div class="map-inspect-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                </div>
            `)
            .openOn(this.map);

            try {
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
                            `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,precipitation` +
                            `&timezone=auto`;
                const r = await fetch(url);
                const j = await r.json();
                const c = j.current;
                if (!c) throw new Error('No data');

                const codeMap = {
                    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
                    45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle',
                    55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
                    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
                    80: 'Rain showers', 81: 'Showers', 82: 'Violent showers',
                    95: 'Thunderstorm', 96: 'Thunder + hail', 99: 'Severe storm'
                };
                const desc = codeMap[c.weather_code] || 'Weather';

                popup.setContent(`
                    <div class="map-inspect">
                        <div class="map-inspect-title">${desc}</div>
                        <div class="map-inspect-row">
                            <span>🌡️ ${c.temperature_2m}°C</span>
                            <span>💧 ${c.relative_humidity_2m}%</span>
                        </div>
                        <div class="map-inspect-row">
                            <span>💨 ${c.wind_speed_10m} km/h</span>
                            <span>☔ ${c.precipitation} mm</span>
                        </div>
                        <div class="map-inspect-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                    </div>
                `);
            } catch (err) {
                popup.setContent(`
                    <div class="map-inspect">
                        <div class="map-inspect-title">Weather unavailable</div>
                        <div class="map-inspect-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                    </div>
                `);
            }
        });
    }

    bindTimelineControls() {
        this.timelinePlay = document.getElementById('radarPlayPause');
        this.timelineSlider = document.getElementById('radarSlider');
        this.timelineLabel = document.getElementById('radarTimestamp');
        this.timelineSpeed = document.getElementById('radarSpeedToggle');
        this.timelineChips = document.getElementById('radarFrameChips');

        if (this.timelinePlay) {
            this.timelinePlay.addEventListener('click', () => {
                if (this.isPlaying) this.pausePlayback();
                else this.startPlayback();
            });
        }
        if (this.timelineSlider) {
            this.timelineSlider.addEventListener('input', (e) => {
                this.pausePlayback();
                this.setFrame(parseInt(e.target.value, 10));
            });
        }
        this.timelineSpeed?.addEventListener('click', () => {
            this.playbackSpeed = this.playbackSpeed === 1 ? 2 : 1;
            this.timelineSpeed.textContent = `${this.playbackSpeed}×`;
            this.timelineSpeed.setAttribute('aria-label', `Radar playback speed, ${this.playbackSpeed}x`);
            if (this.isPlaying) { this.pausePlayback(); this.startPlayback(); }
        });
    }

    startPlayback() {
        if (this.radarLayers.length === 0) return;
        this.isPlaying = true;
        if (this.timelinePlay) {
            this.timelinePlay.innerHTML = '<i class="fas fa-pause"></i>';
            this.timelinePlay.classList.add('playing');
        }
        if (this.playbackTimer) clearInterval(this.playbackTimer);
        this.playbackTimer = setInterval(() => {
            let next = this.currentFrameIndex + 1;
            if (next >= this.radarLayers.length) next = 0;
            this.setFrame(next);
        }, 550 / this.playbackSpeed);
    }

    pausePlayback() {
        this.isPlaying = false;
        if (this.playbackTimer) clearInterval(this.playbackTimer);
        this.playbackTimer = null;
        if (this.timelinePlay) {
            this.timelinePlay.innerHTML = '<i class="fas fa-play"></i>';
            this.timelinePlay.classList.remove('playing');
        }
    }

    setFrame(index) {
        if (!this.radarLayers[index]) return;
        const prev = this.radarLayers[this.currentFrameIndex];
        if (prev && this.map.hasLayer(prev)) this.map.removeLayer(prev);
        this.currentFrameIndex = index;
        this.radarLayers[index].addTo(this.map);
        this.updateTimelineUI();
    }

    updateTimelineUI() {
        if (!this.radarFrames[this.currentFrameIndex]) return;
        const frame = this.radarFrames[this.currentFrameIndex];

        if (this.timelineSlider) {
            this.timelineSlider.value = this.currentFrameIndex;
            this.timelineSlider.max = this.radarLayers.length - 1;
        }
        if (this.timelineLabel) {
            const date = new Date(frame.time * 1000);
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            const isFuture = frame.time * 1000 > Date.now();
            this.timelineLabel.textContent = `${isFuture ? 'Forecast' : 'Observed'} • ${hh}:${mm}`;
        }
        if (this.timelineChips) {
            if (this.timelineChips.childElementCount !== this.radarFrames.length) {
                this.timelineChips.replaceChildren(...this.radarFrames.map((frame, index) => {
                    const button = document.createElement('button');
                    const date = new Date(frame.time * 1000);
                    button.type = 'button';
                    button.className = 'radar-frame-chip';
                    button.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    button.addEventListener('click', () => {
                        this.pausePlayback();
                        this.setFrame(index);
                    });
                    return button;
                }));
            }
            this.timelineChips.querySelectorAll('.radar-frame-chip').forEach((chip, index) => {
                chip.classList.toggle('active', index === this.currentFrameIndex);
            });
        }
    }

    showTimeline() { document.getElementById('radarTimeline')?.classList.add('visible'); }
    hideTimeline() { document.getElementById('radarTimeline')?.classList.remove('visible'); }

    showLegend(type, values = []) {
        const el = document.getElementById('mapLegend');
        if (!el) return;
        const legends = {
            precip: { title: 'Rain intensity', stops: ['#a0e8ff','#3aa0ff','#1e50d6','#ffee00','#ff8c00','#ff0000'] },
            temp:   { title: 'Temperature',    stops: ['#4b0082','#0000ff','#00ffff','#00ff00','#ffff00','#ff8c00','#ff0000'] },
            wind:   { title: 'Wind speed',     stops: ['#e0f7fa','#4fc3f7','#0288d1','#01579b','#4a148c'] },
            clouds: { title: 'Cloud cover',    stops: ['#ffffff','#cccccc','#888888','#555555','#222222'] }
        };
        const cfg = legends[type];
        if (!cfg) return;
        const limits = values.length ? `
            <div class="map-legend-range">${Math.min(...values).toFixed(1)} – ${Math.max(...values).toFixed(1)}${type === 'temp' ? ' °C' : type === 'wind' ? ' km/h' : '%'}</div>
        ` : '';
        el.innerHTML = `
            <div class="map-legend-title">${cfg.title}</div>
            <div class="map-legend-bar">${cfg.stops.map(c => `<span style="background:${c}"></span>`).join('')}</div>
            ${limits}
        `;
        el.classList.add('visible');
    }

    hideLegend() { document.getElementById('mapLegend')?.classList.remove('visible'); }

    setLocation(location) {
        if (!this.validLocation(location)) return;
        const oldLat = this.location?.lat;
        const oldLon = this.location?.lon;
        this.location = location;
        if (!this.map) return;

        const coords = [location.lat, location.lon];
        this.createLocationMarker();

        if (oldLat !== location.lat || oldLon !== location.lon) {
            const zoom = location.precise ? 16 : Math.max(this.map.getZoom(), 11);
            this.map.flyTo(coords, zoom, { duration: 1.4 });
            if (this.nearestRain.enabled && this.radarFrames.length > 0) {
                this.scanNearestRain();
            }
        }
    }

    onShow() {
        if (!this.map) {
            this.init(this.location || CONFIG.DEFAULT_LOCATION);
            if (!this.map) return;
        }
        setTimeout(() => {
            this.map.invalidateSize();
            if (this.tracking.heatVisible) this.showTrailHeat();
        }, 150);
        this.scheduleWeatherOverlayRefresh();
        if (this.nearestRain.enabled && this.radarFrames.length > 0) {
            this.startNearestRainTimer();
            this.scanNearestRain();
        }
    }

    onHide() {
        if (this.isPlaying) this.pausePlayback();
        this.stopNearestRainTimer();
    }

    validLocation(loc) {
        return loc &&
            Number.isFinite(Number(loc.lat)) &&
            Number.isFinite(Number(loc.lon)) &&
            Number(loc.lat) >= -90 && Number(loc.lat) <= 90 &&
            Number(loc.lon) >= -180 && Number(loc.lon) <= 180;
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    showStatus(msg) {
        const s = document.getElementById('weatherMapStatus');
        if (s) { s.textContent = msg; s.hidden = false; }
    }
    hideStatus() {
        const s = document.getElementById('weatherMapStatus');
        if (s) s.hidden = true;
    }
}

export const WeatherMap = new WeatherMapModule();