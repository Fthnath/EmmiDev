import { CONFIG, getApiKey } from '../config.js';
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
        this.isPlaying = false;
        this.activeLayer = null;
        this.layerLayers = {};
        this.location = null;
        this.initialized = false;
        this.pendingClickHandler = null;
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

        // Zoom: use 16 if precise GPS, else 10
        const initialZoom = this.location.precise ? 16 : 10;

        this.map = leaflet.map(container, {
            zoomControl: false,
            preferCanvas: true,
            minZoom: 2,
            maxZoom: 19,
            worldCopyJump: true,
            tap: true
        }).setView([this.location.lat, this.location.lon], initialZoom);

        // Basemaps
        this.streetLayer = leaflet.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { maxZoom: 19, attribution: '&copy; OpenStreetMap' }
        );
        this.satelliteLayer = leaflet.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19, attribution: '&copy; Esri' }
        );
        this.streetLayer.addTo(this.map);

        // Location marker + accuracy circle
        this.createLocationMarker();

        // Controls
        leaflet.control.zoom({ position: 'bottomright' }).addTo(this.map);
        leaflet.control.scale({ position: 'bottomleft', imperial: false }).addTo(this.map);

        // Bind UI
        this.bindLayerButtons();
        this.bindBasemapToggle();
        this.bindTimelineControls();
        this.bindRecenterButton();
        this.bindMapClickInspect();

        this.initialized = true;

        // Kick off radar load in background
        this.loadRainRadar();

        // Set default layer state
        const precipBtn = document.querySelector('.map-layer-btn[data-layer="precip"]');
        if (precipBtn) {
            this.activeLayer = 'precip';
            precipBtn.classList.add('active');
        }
    }

    /* ============================================================
       LOCATION MARKER — pulsing dot + accuracy circle
       ============================================================ */
    createLocationMarker() {
        const leaflet = window.L;
        const coords = [this.location.lat, this.location.lon];

        // Remove old
        if (this.locationMarker) this.map.removeLayer(this.locationMarker);
        if (this.accuracyCircle) this.map.removeLayer(this.accuracyCircle);

        // Pulsing dot
        const pulseIcon = leaflet.divIcon({
            className: 'map-location-pulse',
            html: `
                <span class="map-location-ring"></span>
                <span class="map-location-dot"></span>
            `,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });

        this.locationMarker = leaflet.marker(coords, {
            icon: pulseIcon,
            zIndexOffset: 1000,
            interactive: true
        }).addTo(this.map);

        const popupHtml = `
            <div class="map-popup">
                <strong>${this.escapeHtml(formatLocationLabel(this.location) || 'My Location')}</strong>
                <div class="map-popup-coords">
                    ${this.location.lat.toFixed(5)}, ${this.location.lon.toFixed(5)}
                </div>
                ${this.location.accuracy ? `<div class="map-popup-acc">± ${Math.round(this.location.accuracy)} m accuracy</div>` : ''}
            </div>
        `;
        this.locationMarker.bindPopup(popupHtml);

        // Accuracy circle (only if GPS provided accuracy)
        if (this.location.accuracy && this.location.accuracy < 5000) {
            this.accuracyCircle = leaflet.circle(coords, {
                radius: this.location.accuracy,
                color: '#1a73e8',
                fillColor: '#1a73e8',
                fillOpacity: 0.1,
                weight: 1.5,
                opacity: 0.5,
                interactive: false
            }).addTo(this.map);
        }
    }

    /* ============================================================
       LAYER BUTTONS
       ============================================================ */
    bindLayerButtons() {
        document.querySelectorAll('.map-layer-btn[data-layer]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleLayer(btn.dataset.layer, btn));
        });
    }

    toggleLayer(layerType, button) {
        if (!this.map) return;

        const wasActive = button.classList.contains('active');

        // Clear active states
        document.querySelectorAll('.map-layer-btn[data-layer]').forEach(b => {
            b.classList.remove('active');
        });

        // Remove existing overlay
        Object.values(this.layerLayers).forEach(layer => {
            if (layer && this.map.hasLayer(layer)) this.map.removeLayer(layer);
        });
        if (this.radarLayers[this.currentFrameIndex] &&
            this.map.hasLayer(this.radarLayers[this.currentFrameIndex])) {
            this.map.removeLayer(this.radarLayers[this.currentFrameIndex]);
        }

        if (this.isPlaying) this.pausePlayback();

        if (wasActive) {
            this.activeLayer = null;
            this.hideTimeline();
            this.hideLegend();
            return;
        }

        button.classList.add('active');
        this.activeLayer = layerType;

        if (layerType === 'precip') {
            this.activatePrecip(button);
        } else {
            this.activateWeatherLayer(layerType, button);
        }
    }

    /* ============================================================
       PRECIPITATION (RainViewer animated)
       ============================================================ */
    async activatePrecip(button) {
        // Ensure radar is loaded
        if (this.radarLayers.length === 0) {
            button.classList.add('loading');
            await this.loadRainRadar();
            button.classList.remove('loading');
        }
        if (this.radarLayers.length === 0) {
            this.showStatus('Rain radar unavailable. Base map still works.');
            return;
        }

        // Show latest frame first
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

            // CORRECT RainViewer tile URL:
            //   {host}{path}/256/{z}/{x}/{y}/{colorScheme}/{smooth}_{snow}.png
            //   colorScheme 4 = "Universal Blue"  (best for general use)
            //   smooth=1, snow=1 → both effects on
            this.radarLayers = this.radarFrames.map(frame => {
                const url =
                    `${this.radarHost}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`;
                return leaflet.tileLayer(url, {
                    opacity: 0.7,
                    maxZoom: 19,
                    maxNativeZoom: 10,
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>'
                });
            });

            this.hideStatus();

            // Auto-attach if precip is already the active layer
            if (this.activeLayer === 'precip') {
                this.currentFrameIndex = this.radarLayers.length - 1;
                this.radarLayers[this.currentFrameIndex].addTo(this.map);
                this.showTimeline();
                this.showLegend('precip');
                this.updateTimelineUI();
            }
        } catch (err) {
            console.error('[WeatherMap] Rain radar failed:', err);
            this.showStatus('Rain radar is unavailable. Base map still works.');
        }
    }

    /* ============================================================
       TEMP / WIND / CLOUD LAYERS (OpenWeatherMap free tier)
       ============================================================ */
    activateWeatherLayer(type, button) {
        const key = getApiKey('OWM');
        if (typeof key !== 'string' || !key.trim()) {
            this.showStatus(`${type} overlay needs an OpenWeatherMap key. Rain radar and map inspection still work.`);
            button.classList.remove('active');
            this.activeLayer = null;
            return;
        }

        const leaflet = window.L;
        const urls = {
            temp:   `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${key}`,
            wind:   `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${key}`,
            clouds: `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${key}`
        };

        const layer = leaflet.tileLayer(urls[type], {
            opacity: 0.7,
            maxZoom: 19,
            attribution: '&copy; OpenWeatherMap'
        });

        this.layerLayers[type] = layer;
        layer.addTo(this.map);
        this.showLegend(type);
    }

    /* ============================================================
       BASEMAP TOGGLE
       ============================================================ */
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

    /* ============================================================
       RECENTER
       ============================================================ */
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

    /* ============================================================
       CLICK-TO-INSPECT (tap map → show weather at that point)
       ============================================================ */
    bindMapClickInspect() {
        if (!this.map) return;
        this.map.on('click', async (e) => {
            const { lat, lng } = e.latlng;
            const popup = window.L.popup({
                className: 'map-inspect-popup',
                maxWidth: 280,
                closeButton: true
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

    /* ============================================================
       TIMELINE
       ============================================================ */
    bindTimelineControls() {
        this.timelinePlay = document.getElementById('radarPlayPause');
        this.timelineSlider = document.getElementById('radarSlider');
        this.timelineLabel = document.getElementById('radarTimestamp');

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
    }

    startPlayback() {
        if (this.radarLayers.length === 0) return;
        this.isPlaying = true;
        if (this.timelinePlay) {
            this.timelinePlay.innerHTML = '<i class="fas fa-pause"></i>';
            this.timelinePlay.classList.add('playing');
        }
        this.playbackTimer = setInterval(() => {
            let next = this.currentFrameIndex + 1;
            if (next >= this.radarLayers.length) next = 0;
            this.setFrame(next);
        }, 550);
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
    }

    showTimeline() {
        document.getElementById('radarTimeline')?.classList.add('visible');
    }
    hideTimeline() {
        document.getElementById('radarTimeline')?.classList.remove('visible');
    }

    /* ============================================================
       LEGEND
       ============================================================ */
    showLegend(type) {
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
        el.innerHTML = `
            <div class="map-legend-title">${cfg.title}</div>
            <div class="map-legend-bar">
                ${cfg.stops.map(c => `<span style="background:${c}"></span>`).join('')}
            </div>
        `;
        el.classList.add('visible');
    }

    hideLegend() {
        document.getElementById('mapLegend')?.classList.remove('visible');
    }

    /* ============================================================
       LOCATION UPDATE
       ============================================================ */
    setLocation(location) {
        if (!this.validLocation(location)) return;
        const oldLat = this.location?.lat;
        const oldLon = this.location?.lon;
        this.location = location;

        if (!this.map) return;

        const coords = [location.lat, location.lon];
        this.createLocationMarker();

        // Only fly if location actually changed
        if (oldLat !== location.lat || oldLon !== location.lon) {
            const zoom = location.precise ? 16 : Math.max(this.map.getZoom(), 11);
            this.map.flyTo(coords, zoom, { duration: 1.4 });
        }
    }

    onShow() {
        if (!this.map) {
            this.init(this.location || CONFIG.DEFAULT_LOCATION);
            if (!this.map) return;
        }
        setTimeout(() => this.map.invalidateSize(), 150);
    }

    /* ============================================================
       UTIL
       ============================================================ */
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