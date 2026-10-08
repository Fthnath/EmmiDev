export const Storage = {
    get(key, fallback = null) {
        let raw;
        try {
            raw = localStorage.getItem(key);
        } catch (err) {
            console.warn('[Storage] Read unavailable for', key, err);
            return fallback;
        }
        try {
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
    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (err) {
            console.error('[Storage] Remove error for', key, err);
            return false;
        }
    },
    clear() {
        try {
            localStorage.clear();
            return true;
        } catch (err) {
            console.error('[Storage] Clear error', err);
            return false;
        }
    },
    setSession(key, value) {
        try { sessionStorage.setItem(key, JSON.stringify(value)); }
        catch (err) { console.error('[Session] Write error', err); }
    },
    getSession(key, fallback = null) {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) {
            console.warn('[Session] Read error for', key, err);
            return fallback;
        }
    }
};
