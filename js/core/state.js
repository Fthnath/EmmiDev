class StateManager {
    constructor(initial = {}) {
        this.state = { ...initial };
        this.listeners = new Map();
    }
    get(key) { return this.state[key]; }
    set(key, value) {
        const prev = this.state[key];
        this.state[key] = value;
        this.emit(key, value, prev);
    }
    update(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new TypeError('State update must be an object');
        }
        Object.entries(patch).forEach(([k, v]) => this.set(k, v));
    }
    on(key, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('State listener must be a function');
        }
        if (!this.listeners.has(key)) this.listeners.set(key, new Set());
        this.listeners.get(key).add(callback);
        return () => {
            const listeners = this.listeners.get(key);
            if (!listeners) return;
            listeners.delete(callback);
            if (listeners.size === 0) this.listeners.delete(key);
        };
    }
    emit(key, value, prev) {
        this.notify(this.listeners.get(key), cb => cb(value, prev), key);
        this.notify(this.listeners.get('*'), cb => cb(key, value, prev), '*');
    }
    notify(listeners, invoke, key) {
        if (!listeners) return;
        for (const callback of [...listeners]) {
            try {
                invoke(callback);
            } catch (err) {
                console.error(`[State] ${key} listener error:`, err);
            }
        }
    }
}
export const AppState = new StateManager({
    currentWeather: null, forecast: null, hourly: null, historical: null,
    airQuality: null, pollen: null, activeLocation: null, locations: [],
    language: 'en', theme: 'auto', units: 'metric', loading: false, error: null,
    healthProfile: null, farmProfile: null, aiChat: []
});
