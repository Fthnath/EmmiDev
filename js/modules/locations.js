/**
 * EmmiDev Weather — Location Manager
 * Save up to 20 locations, autocomplete, map picker, geolocation.
 */

import { Storage } from '../core/storage.js';
import { CONFIG } from '../config.js';
import { Bus, Events } from '../core/events.js';
import { searchCities, reverseGeocode } from '../core/api.js';
import { Toast } from '../ui/toast.js';
import { Modal } from '../ui/modals.js';

class LocationManagerClass {
    constructor() {
        this._active = null;
        this._list = [];
        this._recent = [];
        this._listeners = [];
    }

    async init() {
        this._list = Storage.get(CONFIG.STORAGE_KEYS.LOCATIONS, []);
        this._active = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_LOCATION, null);
        this._recent = Storage.get(CONFIG.STORAGE_KEYS.RECENT_CITIES, []);

        // Ensure default location exists on first visit
        if (!this._active && this._list.length === 0) {
            const def = { ...CONFIG.DEFAULT_LOCATION, id: this._makeId(CONFIG.DEFAULT_LOCATION) };
            this._list.push(def);
            Storage.set(CONFIG.STORAGE_KEYS.LOCATIONS, this._list);
        }
    }

    // ---------- GETTERS ----------

    getActive() {
        return this._active || this._list[0] || null;
    }

    getAll() {
        return [...this._list];
    }

    getRecent() {
        return [...this._recent];
    }

    count() {
        return this._list.length;
    }

    has(lat, lon) {
        return this._list.some(l => this._sameCoord(l, { lat, lon }));
    }

    // ---------- MUTATORS ----------

    setActive(loc) {
        if (!loc) return;
        const withId = loc.id ? loc : { ...loc, id: this._makeId(loc) };
        this._active = withId;

        // Ensure it's in the saved list
        if (!this.has(withId.lat, withId.lon)) {
            this.add(withId, /* silent */ true);
        }

        Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_LOCATION, withId);
        this._emit();
        Bus.emit(Events.LOCATION_CHANGED, withId);
    }

    add(loc, silent = false) {
        if (!loc || loc.lat == null || loc.lon == null) return null;

        if (this._list.length >= CONFIG.MAX_LOCATIONS) {
            if (!silent) Toast.warning(`Max ${CONFIG.MAX_LOCATIONS} locations`);
            return null;
        }

        if (this.has(loc.lat, loc.lon)) {
            const existing = this._list.find(l => this._sameCoord(l, loc));
            if (!silent) Toast.info(`${existing.name} is already saved`);
            return existing;
        }

        const item = {
            id: this._makeId(loc),
            name: loc.name || 'Unknown',
            country: loc.country || '',
            state: loc.state || '',
            lat: loc.lat,
            lon: loc.lon,
            addedAt: Date.now(),
            label: loc.label || null
        };

        this._list.push(item);
        Storage.set(CONFIG.STORAGE_KEYS.LOCATIONS, this._list);

        if (!silent) {
            Toast.success(`Added ${item.name}`);
            this._emit();
        }
        return item;
    }

    async addFromCoords(lat, lon) {
        const resolved = await reverseGeocode(lat, lon);
        const loc = {
            name: resolved.name || 'My Location',
            country: resolved.country || '',
            state: resolved.state || '',
            lat, lon
        };
        this.add(loc, true);
        this.setActive(loc);
        return loc;
    }

    remove(locOrId) {
        const id = typeof locOrId === 'string' ? locOrId : locOrId.id;
        const target = this._list.find(l => l.id === id);
        if (!target) return;

        this._list = this._list.filter(l => l.id !== id);
        Storage.set(CONFIG.STORAGE_KEYS.LOCATIONS, this._list);

        // If we removed the active one, switch to first available
        if (this._active && this._active.id === id) {
            this._active = this._list[0] || null;
            Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_LOCATION, this._active);
            if (this._active) Bus.emit(Events.LOCATION_CHANGED, this._active);
        }

        Toast.info(`Removed ${target.name}`);
        this._emit();
    }

    rename(locOrId, newName) {
        const id = typeof locOrId === 'string' ? locOrId : locOrId.id;
        const item = this._list.find(l => l.id === id);
        if (!item || !newName) return;
        item.label = newName;
        Storage.set(CONFIG.STORAGE_KEYS.LOCATIONS, this._list);
        this._emit();
    }

    clearAll() {
        this._list = [];
        this._active = null;
        Storage.set(CONFIG.STORAGE_KEYS.LOCATIONS, []);
        Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_LOCATION, null);
        this._emit();
    }

    // ---------- RECENT (autocomplete history) ----------

    pushRecent(city) {
        if (!city || !city.name) return;
        this._recent = this._recent.filter(c =>
            c.name !== city.name || c.country !== city.country
        );
        this._recent.unshift({
            name: city.name,
            country: city.country || '',
            state: city.state || '',
            lat: city.lat,
            lon: city.lon
        });
        this._recent = this._recent.slice(0, CONFIG.MAX_RECENT_CITIES);
        Storage.set(CONFIG.STORAGE_KEYS.RECENT_CITIES, this._recent);
    }

    // ---------- SEARCH ----------

    async search(query) {
        return await searchCities(query, 8);
    }

    // ---------- OBSERVERS ----------

    onChange(cb) {
        this._listeners.push(cb);
        return () => {
            this._listeners = this._listeners.filter(fn => fn !== cb);
        };
    }

    _emit() {
        this._listeners.forEach(cb => {
            try { cb(this.getActive()); }
            catch (err) { console.error('[LocationManager] listener error:', err); }
        });
    }

    // ---------- HELPERS ----------

    _sameCoord(a, b) {
        if (!a || !b) return false;
        return Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;
    }

    _makeId(loc) {
        return `loc_${loc.lat.toFixed(3)}_${loc.lon.toFixed(3)}`;
    }

    // ---------- UI: ADD LOCATION MODAL ----------

    showAddLocationModal() {
        const content = `
            <div style="padding:0">
                <div class="search-bar" style="margin-bottom:16px;max-width:100%">
                    <i class="fas fa-search"></i>
                    <input type="text" id="modalSearchInput" placeholder="Search city name..." autocomplete="off">
                </div>
                <div id="modalSearchResults" style="max-height:340px;overflow-y:auto"></div>
            </div>
        `;

        const { body } = Modal.open({
            title: '📍 Add Location',
            content,
            size: 'md'
        });

        const input = body.querySelector('#modalSearchInput');
        const results = body.querySelector('#modalSearchResults');

        // Show recents initially
        if (this._recent.length) {
            results.innerHTML = `
                <div style="font-size:0.75rem;color:var(--text-muted);font-weight:600;letter-spacing:0.5px;margin-bottom:8px">
                    RECENT
                </div>
                ${this._recent.map(c => `
                    <div class="suggestion-item" data-lat="${c.lat}" data-lon="${c.lon}"
                        data-name="${this._esc(c.name)}" data-country="${this._esc(c.country)}">
                        <i class="fas fa-history"></i>
                        <span>${this._esc(c.name)}${c.state ? ', ' + this._esc(c.state) : ''}${c.country ? ', ' + this._esc(c.country) : ''}</span>
                    </div>
                `).join('')}
            `;
            this._wireModalResults(results);
        }

        let debounceTimer;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const q = input.value.trim();
            if (q.length < 2) return;
            debounceTimer = setTimeout(async () => {
                results.innerHTML = `<div style="text-align:center;padding:20px"><div class="loader loader-inline"></div></div>`;
                const cities = await this.search(q);
                if (!cities.length) {
                    results.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">No results</div>`;
                    return;
                }
                results.innerHTML = cities.map(c => `
                    <div class="suggestion-item" data-lat="${c.lat}" data-lon="${c.lon}"
                        data-name="${this._esc(c.name)}" data-country="${this._esc(c.country)}"
                        data-state="${this._esc(c.state)}">
                        <i class="fas fa-map-marker-alt"></i>
                        <span>${this._esc(c.name)}${c.state ? ', ' + this._esc(c.state) : ''}, ${this._esc(c.country)}</span>
                    </div>
                `).join('');
                this._wireModalResults(results);
            }, 300);
        });

        input.focus();
    }

    _wireModalResults(container) {
        container.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const city = {
                    name: item.dataset.name,
                    country: item.dataset.country,
                    state: item.dataset.state || '',
                    lat: parseFloat(item.dataset.lat),
                    lon: parseFloat(item.dataset.lon)
                };
                this.pushRecent(city);
                const added = this.add(city, true);
                this.setActive(added || city);
                Modal.closeAll();
                Toast.success(`Now showing ${city.name}`);
            });
        });
    }

    _esc(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    }

    // ---------- UI: LOCATIONS LIST VIEW ----------

    renderLocationsView(container) {
        if (!container) return;
        const active = this.getActive();
        const all = this.getAll();

        if (!all.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-map-marker-alt"></i>
                    <h3>No locations saved</h3>
                    <p>Add your first location to get started</p>
                </div>
            `;
            return;
        }

        container.innerHTML = all.map(loc => {
            const isActive = active && active.id === loc.id;
            return `
                <div class="location-card ${isActive ? 'active' : ''}" data-loc-id="${loc.id}">
                    <div class="location-card-header">
                        <i class="fas fa-map-marker-alt"></i>
                        <div>
                            <h4>${this._esc(loc.label || loc.name)}</h4>
                            <p>${this._esc(loc.state ? loc.state + ', ' : '')}${this._esc(loc.country)}</p>
                        </div>
                    </div>
                    <div class="location-card-actions">
                        ${isActive
                            ? '<span class="badge badge-primary">Active</span>'
                            : `<button class="btn btn-sm btn-primary" data-action="activate" data-id="${loc.id}">Set Active</button>`
                        }
                        <button class="btn btn-sm btn-ghost" data-action="remove" data-id="${loc.id}" title="Remove">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                const loc = this._list.find(l => l.id === id);
                if (!loc) return;

                if (action === 'activate') {
                    this.setActive(loc);
                    Toast.success(`Switched to ${loc.name}`);
                } else if (action === 'remove') {
                    this.remove(loc);
                }
            });
        });
    }
}

export const LocationManager = new LocationManagerClass();
