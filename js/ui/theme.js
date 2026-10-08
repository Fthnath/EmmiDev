/**
 * EmmiDev Weather — Theme Engine
 * Modes: light | dark | auto (follows system)
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { Bus, Events } from '../core/events.js';

class ThemeManager {
    constructor() {
        this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.mode = 'auto';
    }

    init() {
        this.mode = Storage.get(CONFIG.STORAGE_KEYS.THEME) || CONFIG.DEFAULT_THEME;
        this.apply();
        
        // Listen to system preference changes when in auto mode
        this.mediaQuery.addEventListener('change', () => {
            if (this.mode === 'auto') this.apply();
        });
        
        return this;
    }

    set(mode) {
        if (!['light', 'dark', 'auto'].includes(mode)) return;
        this.mode = mode;
        Storage.set(CONFIG.STORAGE_KEYS.THEME, mode);
        this.apply();
        Bus.emit(Events.THEME_CHANGED, mode);
    }

    apply() {
        const effective = this.getEffective();
        document.documentElement.setAttribute('data-theme', effective);
        document.documentElement.setAttribute('data-theme-mode', this.mode);
        
        // Update meta theme-color for mobile browser chrome
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', effective === 'dark' ? '#0f0f1e' : '#1a73e8');
        }
    }

    getEffective() {
        if (this.mode === 'auto') {
            return this.mediaQuery.matches ? 'dark' : 'light';
        }
        return this.mode;
    }

    toggle() {
        const next = this.getEffective() === 'dark' ? 'light' : 'dark';
        this.set(next);
    }

    current() {
        return this.getEffective();
    }
}

export const Theme = new ThemeManager();
