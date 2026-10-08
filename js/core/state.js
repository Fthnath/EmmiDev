class StateManager {
    constructor(initial = {}) {
        this.state = initial;
        this.listeners = new Map();
    }
    get(key) { return this.state[key]; }
    set(key, value) {
        const prev = this.state[key];
        this.state[key] = value;
        this.emit(key, value, prev);
    }
    update(patch) { Object.entries(patch).forEach(([k, v]) => this.set(k, v)); }
    on(key, callback) {
        if (!this.listeners.has(key)) this.listeners.set(key, new Set());
        this.listeners.get(key).add(callback);
        return () => this.listeners.get(key).delete(callback);
    }
    emit(key, value, prev) {
        const subs = this.listeners.get(key);
        if (subs) subs.forEach(cb => cb(value, prev));
        const wild = this.listeners.get('*');
        if (wild) wild.forEach(cb => cb(key, value, prev));
    }
}
export const AppState = new StateManager({
    currentWeather: null, forecast: null, hourly: null, historical: null,
    airQuality: null, pollen: null, activeLocation: null, locations: [],
    language: 'en', theme: 'auto', units: 'metric', loading: false, error: null,
    healthProfile: null, farmProfile: null, aiChat: []
});
