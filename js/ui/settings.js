/**
 * EmmiDev Weather — Settings Module
 * Language, theme, units, API keys
 */

import { CONFIG } from '../config.js';
import { Storage } from '../core/storage.js';
import { Bus, Events } from '../core/events.js';
import { i18n } from './i18n.js';
import { $, create } from '../utils/dom.js';

export const Settings = {
    init() {
        this.render();
        this.bindEvents();
    },
    
    render() {
        // Settings are rendered in HTML; this just wires them up
        this.applyStoredSettings();
    },
    
    applyStoredSettings() {
        // Language
        const langSelect = $('#languageSelect');
        if (langSelect) {
            const langs = i18n.getAvailableLanguages();
            langSelect.innerHTML = langs.map(l =>
                `<option value="${l.code}">${l.flag} ${l.nativeName}</option>`
            ).join('');
            langSelect.value = Storage.get(CONFIG.STORAGE_KEYS.LANGUAGE) || CONFIG.DEFAULT_LANGUAGE;
        }
        
        // Theme
        const theme = Storage.get(CONFIG.STORAGE_KEYS.THEME) || CONFIG.DEFAULT_THEME;
        document.documentElement.setAttribute('data-theme', theme);
        
        // Units
        const units = Storage.get(CONFIG.STORAGE_KEYS.UNITS) || CONFIG.DEFAULT_UNITS;
        document.documentElement.setAttribute('data-units', units);
        
        // API Keys (masked display)
        const groqInput = $('#groqKeyInput');
        if (groqInput) {
            const key = Storage.get(CONFIG.STORAGE_KEYS.GROQ_KEY);
            if (key) groqInput.value = '••••••••' + key.slice(-4);
        }
    },
    
    bindEvents() {
        // Language switch
        const langSelect = $('#languageSelect');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                i18n.setLanguage(e.target.value);
            });
        }
        
        // Theme switch
        const themeSelect = $('#themeSelect');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                const v = e.target.value;
                Storage.set(CONFIG.STORAGE_KEYS.THEME, v);
                document.documentElement.setAttribute('data-theme', v);
                Bus.emit(Events.THEME_CHANGED, v);
            });
        }
        
        // Units switch
        const unitsSelect = $('#unitsSelect');
        if (unitsSelect) {
            unitsSelect.addEventListener('change', (e) => {
                const v = e.target.value;
                Storage.set(CONFIG.STORAGE_KEYS.UNITS, v);
                document.documentElement.setAttribute('data-units', v);
                Bus.emit(Events.UNITS_CHANGED, v);
            });
        }
        
        // Groq key save
        const groqSave = $('#groqKeySave');
        if (groqSave) {
            groqSave.addEventListener('click', () => {
                const input = $('#groqKeyInput');
                const val = input.value.trim();
                if (!val) return;
                Storage.set(CONFIG.STORAGE_KEYS.GROQ_KEY, val);
                input.value = '••••••••' + val.slice(-4);
                input.disabled = true;
                groqSave.textContent = i18n.t('settings.saved');
                setTimeout(() => {
                    input.disabled = false;
                    groqSave.textContent = i18n.t('settings.save');
                }, 1500);
            });
        }
        
        // Clear data
        const clearBtn = $('#clearDataBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('This will erase all saved data. Continue?')) {
                    Storage.clear();
                    location.reload();
                }
            });
        }
    }
};
