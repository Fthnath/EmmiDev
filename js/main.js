/**
 * EmmiDev Weather 2.0 — Main Entry Point
 * Bootstraps all systems, wires modules together, loads live weather.
 */

import { CONFIG } from './config.js';
import { Storage } from './core/storage.js';
import { AppState } from './core/state.js';
import { Bus, Events } from './core/events.js';
import { router } from './core/router.js';
import { i18n, t } from './ui/i18n.js';
import { Theme } from './ui/theme.js';
import { Toast } from './ui/toast.js';
import { Modal } from './ui/modals.js';
import { Settings } from './ui/settings.js';
import { WeatherScene } from './ui/animations.js';
import { LocationManager } from './modules/locations.js';
import { Weather } from './modules/weather.js';
import { AI } from './modules/ai.js';
import { runSelfTests } from './core/config-tests.js';

// ============================================
// GLOBAL STATE
// ============================================

let weatherScene = null;
let currentLocation = null;
let deferredInstallPrompt = null;

// ============================================
// BOOTSTRAP
// ============================================

async function bootstrap() {
    logBanner();

    // ---- 1. Theme (before anything visual) ----
    Theme.init();

    // ---- 2. i18n ----
    await i18n.init();
    i18n.translatePage();

    // ---- 3. Register routes ----
    registerRoutes();
    router.init((view) => {
        console.log('[Router] →', view);
        Bus.emit('route:changed', view);
    });

    // ---- 4. Settings UI ----
    Settings.init();

    // ---- 5. Nav click wiring ----
    wireNavigation();

    // ---- 6. Theme toggle button ----
    wireThemeToggle();

    // ---- 7. Initialize weather scene (hero canvas) ----
    try {
        initWeatherScene();
    } catch (err) {
        weatherScene = null;
        console.error('[WeatherScene] Animation unavailable; continuing without it:', err);
    }

    // ---- 8. Location manager ----
    await initLocationManager();

    // ---- 9. Weather module ----
    Weather.init();

    // ---- 10. AI module ----
    AI.init();

    // ---- 11. PWA install prompt ----
    wirePwaInstall();

    // ---- 12. Service worker ----
    registerServiceWorker();

    // ---- 13. Language change handler ----
    Bus.on(Events.LANGUAGE_CHANGED, (code) => {
        Toast.info(`Language: ${code.toUpperCase()}`, 1800);
    });

    // ---- 14. Load weather from saved or geolocation ----
    await loadInitialWeather();

    // ---- 15. Self-tests in dev ----
    if (isDevEnvironment()) {
        await runSelfTests();
    }

    // ---- 16. Welcome toast ----
    maybeShowWelcome();

    // ---- Ready ----
    console.log('%c✅ EmmiDev Weather ready.',
        'color:#22c55e;font-weight:bold;font-size:14px;');

    // Expose for debugging
    window.__EmmiDev = {
        AppState, Bus, Events, Theme, i18n, Toast, Modal,
        router, Settings, LocationManager, Weather, AI,
        get weatherScene() { return weatherScene; }
    };
    window.__setWeatherScene = (opts) => weatherScene?.setWeather(opts);
    window.__t = t;
}

// ============================================
// ROUTES
// ============================================

function registerRoutes() {
    const routes = [
        'home', 'forecast', 'maps', 'health',
        'farming', 'ai', 'locations', 'history',
        'settings', 'about'
    ];
    routes.forEach(r => router.register('#' + r, r));
}

// ============================================
// NAVIGATION
// ============================================

function wireNavigation() {
    document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const target = el.dataset.nav;
            if (target) router.navigate(target);
        });
    });
}

function wireThemeToggle() {
    const themeBtn = document.getElementById('themeToggle');
    if (!themeBtn) return;
    updateThemeIcon(themeBtn);

    themeBtn.addEventListener('click', () => {
        Theme.toggle();
        updateThemeIcon(themeBtn);
    });

    Bus.on(Events.THEME_CHANGED, () => updateThemeIcon(themeBtn));
}

function updateThemeIcon(btn) {
    const icon = btn.querySelector('i');
    if (!icon) return;
    icon.className = Theme.current() === 'dark'
        ? 'fas fa-sun'
        : 'fas fa-moon';
}

// ============================================
// WEATHER SCENE
// ============================================

function initWeatherScene() {
    const canvas = document.getElementById('heroWeatherCanvas');
    if (!canvas) return;
    if (typeof canvas.getContext !== 'function' || !canvas.getContext('2d')) {
        console.error('[WeatherScene] 2D canvas is unavailable; skipping animation.');
        return;
    }

    weatherScene = new WeatherScene(canvas);
    weatherScene.setWeather({
        condition: 'clear',
        isDay: isDaytime(),
        temperature: 24,
        windSpeed: 3
    });
    weatherScene.start();

    // Pause when tab hidden (perf win)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) weatherScene.stop();
        else weatherScene.start();
    });

    // Pause when hero canvas is off-screen (perf win)
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) weatherScene.start();
                else weatherScene.stop();
            });
        }, { threshold: 0.05 });
        io.observe(canvas);
    }
}

function isDaytime() {
    const h = new Date().getHours();
    return h >= 6 && h < 19;
}

// ============================================
// LOCATION MANAGER
// ============================================

async function initLocationManager() {
    await LocationManager.init();
    LocationManager.onChange((loc) => {
        currentLocation = loc;
        console.log('[Location] →', loc);
        Weather.loadFor(loc);
    });
}

// ============================================
// INITIAL WEATHER LOAD
// ============================================

async function loadInitialWeather() {
    // Priority: saved active location > geolocation > default
    const saved = LocationManager.getActive();
    if (saved) {
        currentLocation = saved;
        Weather.loadFor(saved);
        return;
    }

    // Try geolocation
    if ('geolocation' in navigator) {
        try {
            Toast.info('Detecting your location...', 2000);
            const pos = await getPosition({ timeout: 8000 });
            const loc = await LocationManager.addFromCoords(
                pos.coords.latitude,
                pos.coords.longitude
            );
            currentLocation = loc;
            Weather.loadFor(loc);
            return;
        } catch (err) {
            console.warn('[Geo] Denied or failed:', err.message);
            Toast.warning('Location denied — showing Kampala', 3000);
        }
    }

    // Default
    const fallback = { ...CONFIG.DEFAULT_LOCATION };
    currentLocation = fallback;
    LocationManager.setActive(fallback);
    Weather.loadFor(fallback);
}

function getPosition(options = {}) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: options.timeout || 10000,
            maximumAge: 5 * 60 * 1000
        });
    });
}

// ============================================
// PWA
// ============================================

function wirePwaInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        showInstallButtons();
    });

    window.addEventListener('appinstalled', () => {
        console.log('[PWA] App installed');
        deferredInstallPrompt = null;
        hideInstallButtons();
        Toast.success('App installed! 🎉');
    });

    const btn1 = document.getElementById('installPwaBtn');
    const btn2 = document.getElementById('installPwaBtn2');
    [btn1, btn2].forEach(btn => {
        if (btn) btn.addEventListener('click', triggerInstall);
    });
}

function showInstallButtons() {
    const btn1 = document.getElementById('installPwaBtn');
    const btn2 = document.getElementById('installPwaBtn2');
    if (btn1) btn1.style.display = '';
    if (btn2) btn2.style.display = '';
}

function hideInstallButtons() {
    const btn1 = document.getElementById('installPwaBtn');
    const btn2 = document.getElementById('installPwaBtn2');
    if (btn1) btn1.style.display = 'none';
    if (btn2) btn2.style.display = 'none';
}

async function triggerInstall() {
    if (!deferredInstallPrompt) {
        Toast.info('Use your browser menu → "Install app"', 4000);
        return;
    }
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);
    deferredInstallPrompt = null;
}

// ============================================
// SERVICE WORKER
// ============================================

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;

    try {
        const reg = await navigator.serviceWorker.register('./service-worker.js');
        console.log('[SW] Registered:', reg.scope);
    } catch (err) {
        console.warn('[SW] Registration failed:', err.message);
    }
}

// ============================================
// HELPERS
// ============================================

function isDevEnvironment() {
    const h = location.hostname;
    return h === 'localhost'
        || h === '127.0.0.1'
        || h.includes('github.dev')
        || h.includes('app.github.dev')
        || h.includes('codespaces');
}

function maybeShowWelcome() {
    if (Storage.get(CONFIG.STORAGE_KEYS.FIRST_VISIT)) return;
    Storage.set(CONFIG.STORAGE_KEYS.FIRST_VISIT, Date.now());
    setTimeout(() => {
        Toast.success('Welcome to EmmiDev Weather 2.0 🌍', 4000);
    }, 900);
}

function logBanner() {
    console.log(
        `%c🌍 ${CONFIG.APP_NAME} v${CONFIG.APP_VERSION}`,
        'color:#4a9eff;font-weight:bold;font-size:16px;'
    );
    console.log(
        '%cAfrica-first weather intelligence — free forever.',
        'color:#94a3b8;font-size:12px;'
    );
}

// ============================================
// BOOT
// ============================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bootstrap().catch(handleBootstrapError);
    });
} else {
    bootstrap().catch(handleBootstrapError);
}

function handleBootstrapError(err) {
    console.error('[App] Startup failed:', err);
    Toast.error('The app could not start. Please refresh the page.');
}
