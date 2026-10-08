export const Storage = {
    get(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            return JSON.parse(raw);
        } catch (err) {
            console.warn('[Storage] Parse error for', key, err);
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            console.error('[Storage] Write error for', key, err);
            return false;
        }
    },
    remove(key) { localStorage.removeItem(key); },
    clear() { localStorage.clear(); },
    setSession(key, value) {
        try { sessionStorage.setItem(key, JSON.stringify(value)); }
        catch (err) { console.error('[Session] Write error', err); }
    },
    getSession(key, fallback = null) {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) { return fallback; }
    }
};
