/**
 * EmmiDev Weather — Quick Self-Tests
 * Runs on load in development to catch broken imports.
 */

import { CONFIG } from '../config.js';
import { Storage } from './storage.js';
import { AppState } from './state.js';
import { Bus, Events } from './events.js';
import { Theme } from '../ui/theme.js';
import { Toast } from '../ui/toast.js';
import { Modal } from '../ui/modals.js';
import { router } from './router.js';
import { i18n, t } from '../ui/i18n.js';

export async function runSelfTests() {
    const results = [];
    
    const check = (name, fn) => {
        try {
            const ok = fn();
            results.push({ name, ok: !!ok });
        } catch (err) {
            results.push({ name, ok: false, error: err.message });
        }
    };
    
    check('CONFIG exists', () => !!CONFIG.APP_NAME);
    check('Storage works', () => {
        Storage.set('__test__', { x: 1 });
        const v = Storage.get('__test__');
        Storage.remove('__test__');
        return v && v.x === 1;
    });
    check('State works', () => {
        AppState.set('__test__', 42);
        return AppState.get('__test__') === 42;
    });
    check('EventBus works', () => {
        let got = null;
        const off = Bus.on('__test__', (v) => { got = v; });
        Bus.emit('__test__', 'ok');
        off();
        return got === 'ok';
    });
    check('Theme loaded', () => !!Theme.current());
    check('Toast loaded', () => typeof Toast.show === 'function');
    check('Modal loaded', () => typeof Modal.open === 'function');
    check('Router loaded', () => typeof router.navigate === 'function');
    check('i18n loaded', () => typeof t === 'function' && !!i18n.currentLang);
    
    const failed = results.filter(r => !r.ok);
    
    console.groupCollapsed(
        `%cEmmiDev Self-Tests: ${results.length - failed.length}/${results.length} passed`,
        `color: ${failed.length ? '#ef4444' : '#22c55e'}; font-weight: bold;`
    );
    results.forEach(r => {
        const icon = r.ok ? '✅' : '❌';
        const color = r.ok ? '#22c55e' : '#ef4444';
        console.log(`%c${icon} ${r.name}`, `color:${color}`, r.error || '');
    });
    console.groupEnd();
    
    return { results, failed };
}
