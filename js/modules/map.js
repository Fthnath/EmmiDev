import { CONFIG } from '../config.js';

class WeatherMapModule {
    constructor() {
        this.map = null;
        this.marker = null;
        this.radarLayer = null;
        this.location = null;
        this.initialized = false;
    }

    init(location) {
        if (this.initialized) {
            this.setLocation(location);
            return;
        }

        const container = document.getElementById('weather-radar-map');
        if (!container) return;

        const leaflet = window.L;
        if (!leaflet) {
            console.error('[WeatherMap] Leaflet did not load; interactive map is unavailable.');
            this.showStatus('The map library could not load. Check your connection and refresh.');
            return;
        }

        this.location = this.validLocation(location) ? location : CONFIG.DEFAULT_LOCATION;
        this.map = leaflet.map(container).setView(
            [this.location.lat, this.location.lon],
            7
        );
        leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(this.map);

        this.marker = leaflet.marker([this.location.lat, this.location.lon]).addTo(this.map);
        this.updateMarkerPopup();
        this.bindControls();
        this.initialized = true;
        this.loadRainRadar();
    }

    bindControls() {
        document.querySelectorAll('.map-layer-btn[data-layer="precip"]').forEach(button => {
            button.addEventListener('click', () => {
                if (!this.map || !this.radarLayer) return;
                if (this.map.hasLayer(this.radarLayer)) {
                    this.map.removeLayer(this.radarLayer);
                    button.classList.remove('active');
                } else {
                    this.radarLayer.addTo(this.map);
                    button.classList.add('active');
                }
            });
        });
    }

    async loadRainRadar() {
        const controls = document.querySelectorAll('.map-layer-btn[data-layer="precip"]');
        controls.forEach(button => { button.disabled = true; });
        this.showStatus('Loading rain radar…');
        try {
            const response = await fetch(CONFIG.RAINVIEWER_API);
            if (!response.ok) throw new Error(`Rain radar request failed (HTTP ${response.status})`);
            const data = await response.json();
            const frames = data?.radar?.past;
            const frame = Array.isArray(frames) ? frames.at(-1) : null;
            if (!frame?.path || !data.host) {
                throw new Error('Rain radar response did not contain a current radar frame');
            }

            const tileUrl = `${data.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
            this.radarLayer = window.L.tileLayer(tileUrl, {
                opacity: 0.65,
                maxZoom: 19,
                maxNativeZoom: 7,
                attribution: '&copy; RainViewer'
            }).addTo(this.map);
            controls.forEach(button => { button.disabled = false; });
            this.hideStatus();
        } catch (err) {
            console.error('[WeatherMap] Rain radar unavailable:', err);
            controls.forEach(button => {
                button.disabled = true;
                button.classList.remove('active');
            });
            this.showStatus('Rain radar is unavailable right now. The street map is still available.');
        }
    }

    setLocation(location) {
        if (!this.validLocation(location)) return;
        this.location = location;
        if (!this.map) return;

        const coords = [location.lat, location.lon];
        this.marker.setLatLng(coords);
        this.updateMarkerPopup();
        this.map.setView(coords, this.map.getZoom());
    }

    updateMarkerPopup() {
        if (!this.marker || !this.location) return;
        const popup = document.createElement('span');
        popup.textContent = [this.location.name, this.location.country]
            .filter(Boolean)
            .join(', ');
        this.marker.bindPopup(popup);
    }

    onShow() {
        if (!this.map) {
            this.init(this.location || CONFIG.DEFAULT_LOCATION);
            if (!this.map) return;
        }
        requestAnimationFrame(() => this.map.invalidateSize());
    }

    validLocation(location) {
        return location &&
            Number.isFinite(Number(location.lat)) &&
            Number.isFinite(Number(location.lon)) &&
            Number(location.lat) >= -90 && Number(location.lat) <= 90 &&
            Number(location.lon) >= -180 && Number(location.lon) <= 180;
    }

    showStatus(message) {
        const status = document.getElementById('weatherMapStatus');
        if (!status) return;
        status.textContent = message;
        status.hidden = false;
    }

    hideStatus() {
        const status = document.getElementById('weatherMapStatus');
        if (status) status.hidden = true;
    }
}

export const WeatherMap = new WeatherMapModule();
