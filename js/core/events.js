class EventBus {
    constructor() { this.events = new Map(); }
    on(event, callback) {
        if (!this.events.has(event)) this.events.set(event, new Set());
        this.events.get(event).add(callback);
        return () => this.off(event, callback);
    }
    off(event, callback) {
        const subs = this.events.get(event);
        if (subs) subs.delete(callback);
    }
    emit(event, data) {
        const subs = this.events.get(event);
        if (subs) subs.forEach(cb => {
            try { cb(data); }
            catch (err) { console.error(`[EventBus] ${event} error:`, err); }
        });
    }
    once(event, callback) {
        const off = this.on(event, (data) => { off(); callback(data); });
        return off;
    }
}
export const Bus = new EventBus();
export const Events = {
    LOCATION_CHANGED: 'location:changed',
    WEATHER_LOADED: 'weather:loaded',
    FORECAST_LOADED: 'forecast:loaded',
    LANGUAGE_CHANGED: 'language:changed',
    THEME_CHANGED: 'theme:changed',
    UNITS_CHANGED: 'units:changed',
    HEALTH_UPDATED: 'health:updated',
    FARM_UPDATED: 'farm:updated',
    AI_MESSAGE: 'ai:message',
    ALERT_TRIGGERED: 'alert:triggered',
    ERROR: 'app:error'
};
