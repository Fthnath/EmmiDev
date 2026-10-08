/**
 * EmmiDev Weather — Internationalization Engine
 * Loads JSON language files, translates DOM, handles RTL
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { Bus, Events } from '../core/events.js';

export const LANGUAGES = [
    { code: 'en',  name: 'English',    nativeName: 'English',    flag: '🇬🇧', rtl: false },
    { code: 'sw',  name: 'Swahili',    nativeName: 'Kiswahili',  flag: '🇰🇪', rtl: false },
    { code: 'lg',  name: 'Luganda',    nativeName: 'Luganda',    flag: '🇺🇬', rtl: false },
    { code: 'ach', name: 'Acholi',     nativeName: 'Acholi',     flag: '🇺🇬', rtl: false },
    { code: 'luo', name: 'Dholuo',     nativeName: 'Dholuo',     flag: '🇰🇪', rtl: false },
    { code: 'fr',  name: 'French',     nativeName: 'Français',   flag: '🇫🇷', rtl: false },
    { code: 'ar',  name: 'Arabic',     nativeName: 'العربية',    flag: '🇸🇦', rtl: true  },
    { code: 'zh',  name: 'Chinese',    nativeName: '中文',        flag: '🇨🇳', rtl: false }
];

class I18nManager {
    constructor() {
        this.currentLang = 'en';
        this.translations = {};
        this.fallback = {};
    }
    
    async init() {
        // Detect language: stored > browser > default
        const stored = Storage.get(CONFIG.STORAGE_KEYS.LANGUAGE);
        const browser = (navigator.language || 'en').split('-')[0];
        const available = LANGUAGES.map(l => l.code);
        
        let lang = stored;
        if (!lang || !available.includes(lang)) {
            lang = available.includes(browser) ? browser : CONFIG.DEFAULT_LANGUAGE;
        }
        
        // Load English fallback first
        this.fallback = await this.loadLang('en');
        
        // Load selected language
        await this.setLanguage(lang, false);
        
        // Apply to DOM
        this.translatePage();
        this.applyDirection();
        
        return this;
    }
    
    async loadLang(code) {
        try {
            const res = await fetch(`lang/${code}.json`);
            if (!res.ok) throw new Error(`Failed to load ${code}.json`);
            return await res.json();
        } catch (err) {
            console.warn(`[i18n] Could not load ${code}:`, err);
            return {};
        }
    }
    
    async setLanguage(code, broadcast = true) {
        if (!LANGUAGES.find(l => l.code === code)) {
            console.warn(`[i18n] Unknown language: ${code}`);
            return;
        }
        this.translations = await this.loadLang(code);
        this.currentLang = code;
        Storage.set(CONFIG.STORAGE_KEYS.LANGUAGE, code);
        
        this.translatePage();
        this.applyDirection();
        
        if (broadcast) {
            Bus.emit(Events.LANGUAGE_CHANGED, code);
        }
    }
    
    /**
     * Translate using dot notation: t('nav.home')
     * Falls back to English if key missing.
     */
    t(key, params = {}) {
        const value = this.getNested(this.translations, key)
                   ?? this.getNested(this.fallback, key)
                   ?? key;
        return this.interpolate(value, params);
    }
    
    getNested(obj, path) {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }
    
    interpolate(str, params) {
        if (typeof str !== 'string') return str;
        return str.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
    }
    
    /**
     * Scan DOM for [data-i18n] attributes and update text.
     * Also supports:
     *   data-i18n-placeholder  (input placeholder)
     *   data-i18n-title        (title attribute)
     *   data-i18n-aria         (aria-label)
     */
    translatePage(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.setAttribute('placeholder', this.t(el.getAttribute('data-i18n-placeholder')));
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.setAttribute('title', this.t(el.getAttribute('data-i18n-title')));
        });
        root.querySelectorAll('[data-i18n-aria]').forEach(el => {
            el.setAttribute('aria-label', this.t(el.getAttribute('data-i18n-aria')));
        });
    }
    
    /**
     * Set HTML direction for RTL languages (Arabic)
     */
    applyDirection() {
        const lang = LANGUAGES.find(l => l.code === this.currentLang);
        const dir = lang?.rtl ? 'rtl' : 'ltr';
        document.documentElement.setAttribute('dir', dir);
        document.documentElement.setAttribute('lang', this.currentLang);
        document.body.classList.toggle('rtl', !!lang?.rtl);
    }
    
    getCurrentLanguage() {
        return LANGUAGES.find(l => l.code === this.currentLang);
    }
    
    getAvailableLanguages() {
        return LANGUAGES;
    }
}

export const i18n = new I18nManager();

// Shorthand
export const t = (key, params) => i18n.t(key, params);
