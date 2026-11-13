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
import { WeatherMap } from './modules/map.js';
import { Health } from './modules/health.js';           // NEW
import { Farming } from './modules/farming.js';  
import { ShareCard } from './modules/share-card.js';       // NEW
import { RainAnim } from './modules/rain-animation.js'; // Already imported
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

    // ---- 7. NEW: Focus mode toggle ----
    wireFocusModeToggle();

    // ---- 8. Initialize weather scene (hero canvas) ----
    try {
        initWeatherScene();
    } catch (err) {
        weatherScene = null;
        console.error('[WeatherScene] Animation unavailable; continuing without it:', err);
    }

    // ---- 9. NEW: Rain animation (layered on top of scene) ----
    try {
        RainAnim.init();
    } catch (err) {
        console.error('[RainAnim] Failed to init; continuing without it:', err);
    }

    // ---- 10. Location manager ----
    await initLocationManager();

    // ---- 11. Weather map ----
    WeatherMap.init(LocationManager.getActive());
    Bus.on('route:changed', view => {
        if (view === 'maps') WeatherMap.onShow();
        else WeatherMap.onHide?.();       // NEW: pause when leaving
        if (view === 'forecast') Weather.resizeCharts();
        if (view === 'history') Weather.loadHistory();
    });
    Bus.on(Events.LOCATION_CHANGED, location => WeatherMap.setLocation(location));
    if (router.current === 'maps') WeatherMap.onShow();

    // ---- 12. Weather module ----
    Weather.init();

    // ---- 13. NEW: Health module ----
    Health.init();

    // ---- 14. NEW: Farming module ----
    Farming.init();

    // ---- 15. AI module ----
    AI.init();

    // ---- 16. NEW: Wire AI context banner + key warning ----
    wireAiContext();

    // ---- 17. PWA install prompt ----
    wirePwaInstall();

    // ---- 18. Service worker ----
    registerServiceWorker();

    // ---- 19. NEW: Wire SW update toast ----
    wireUpdateToast();

    // ---- 20. NEW: Bottom nav active state ----
    wireBottomNav();

    // ---- 21. NEW: Pull-to-refresh ----
    wirePullToRefresh();

    // ---- 22. NEW: Hero share button ----
    ShareCard.init();

    // ---- 23. Language change handler ----
    Bus.on(Events.LANGUAGE_CHANGED, (code) => {
        Toast.info(`Language: ${code.toUpperCase()}`, 1800);
    });

    // ---- 24. Load weather from saved or geolocation ----
    await loadInitialWeather();
    setupWeatherAutoRefresh();
    if (router.current === 'history') Weather.loadHistory();

    // ---- 25. Self-tests in dev ----
    if (isDevEnvironment()) {
        await runSelfTests();
    }

    // ---- 26. Welcome toast ----
    maybeShowWelcome();

    // ---- Ready ----
    console.log('%c✅ EmmiDev Weather ready.',
        'color:#22c55e;font-weight:bold;font-size:14px;');

    // Expose for debugging
    window.__EmmiDev = {
        AppState, Bus, Events, Theme, i18n, Toast, Modal,
        router, Settings, LocationManager, Weather, AI,
        Health, Farming, WeatherMap, RainAnim,
        get weatherScene() { return weatherScene; }
    };
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
// NEW: FOCUS MODE
// ============================================

function wireFocusModeToggle() {
    const headerBtn = document.getElementById('focusModeToggle');
    const settingsToggle = document.getElementById('focusModeSetting');

    const applyFocusMode = (enabled) => {
        document.body.classList.toggle('focus-mode', enabled);
        Storage.set('emmidev::focusMode', enabled);
        if (headerBtn) headerBtn.setAttribute('aria-pressed', String(enabled));
        if (settingsToggle) settingsToggle.checked = enabled;
        if (enabled) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    };

    // Restore saved
    const saved = Storage.get('emmidev::focusMode', false);
    applyFocusMode(saved);

    // Header toggle
    if (headerBtn) {
        headerBtn.addEventListener('click', () => {
            const enabled = !document.body.classList.contains('focus-mode');
            applyFocusMode(enabled);
        });
    }

    // Settings toggle
    if (settingsToggle) {
        settingsToggle.checked = saved;
        settingsToggle.addEventListener('change', () => {
            applyFocusMode(settingsToggle.checked);
        });
    }

    // Keyboard shortcut: F to toggle, Esc to exit
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea, select')) return;
        if (e.key === 'f' || e.key === 'F') {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            applyFocusMode(!document.body.classList.contains('focus-mode'));
        }
        if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
            applyFocusMode(false);
        }
    });
}

// ============================================
// NEW: AI CONTEXT BANNER
// ============================================

function wireAiContext() {
    const updateBanner = () => {
        const banner = document.getElementById('aiContextText');
        if (!banner) return;
        const w = AppState.get('currentWeather');
        const loc = LocationManager.getActive();
        if (!w?.current || !loc) {
            banner.textContent = 'Using current weather · Waiting for data…';
            return;
        }
        const temp = Math.round(w.current.temperature_2m);
        const cond = describeWeather(w.current.weather_code);
        banner.textContent = `Using ${loc.name} · ${temp}°C · ${cond}`;
    };

    Bus.on(Events.WEATHER_LOADED, updateBanner);
    Bus.on(Events.LOCATION_CHANGED, updateBanner);
    updateBanner();

    // Show API key warning if missing
    const warn = document.getElementById('aiKeyWarning');
    if (warn) {
        const hasKey = (() => {
            try {
                const key = CONFIG.GROQ_API_KEY || Storage.get('emmidev::groqKey');
                return typeof key === 'string' && key.trim().length > 0;
            } catch { return false; }
        })();
        warn.hidden = hasKey;
    }
}

function describeWeather(code) {
    const map = {
        0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
        45: 'Fog', 48: 'Rime fog',
        51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
        61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
        71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
        80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
        95: 'Thunderstorm', 96: 'Thunder + hail', 99: 'Severe storm'
    };
    return map[code] || 'Weather';
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
    window.__setWeatherScene = (opts) => weatherScene?.setWeather(opts);
    weatherScene.setWeather({
        condition: 'clear',
        isDay: isDaytime(),
        temperature: 24,
        windSpeed: 3
    });
    weatherScene.start();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) weatherScene.stop();
        else weatherScene.start();
    });

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

function setupWeatherAutoRefresh() {
    const interval = 10 * 60 * 1000;
    let lastRefresh = Date.now();
    let refreshing = false;

    const refresh = async (force = false) => {
        if (navigator.onLine === false || document.hidden || !currentLocation || refreshing) return;
        if (!force && Date.now() - lastRefresh < interval) return;

        refreshing = true;
        lastRefresh = Date.now();
        try {
            await Weather.loadFor(currentLocation, { refresh: true, quiet: true });
        } finally {
            refreshing = false;
        }
    };

    window.addEventListener('online', () => refresh(true));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refresh();
    });
    window.setInterval(() => refresh(), interval);
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
    if ('geolocation' in navigator) {
        try {
            Toast.info('Detecting your location...', 2000);
            const pos = await getPosition({ timeout: 15000 });
            const loc = await LocationManager.addFromCoords(
                pos.coords.latitude,
                pos.coords.longitude,
                { accuracy: pos.coords.accuracy }
            );
            currentLocation = loc;
            Weather.loadFor(loc);
            return;
        } catch (err) {
            console.warn('[Geo] Denied or failed:', err.message);
            const reason = err.code === 1
                ? 'Allow location access for this site in your browser settings.'
                : err.code === 3
                    ? 'Location detection timed out. Check that location services are enabled.'
                    : 'Your device could not provide a location.';
            Toast.warning(`${reason} Showing your saved place instead.`, 5000);
        }
    } else {
        Toast.warning('This browser does not support location detection. Showing your saved place instead.', 5000);
    }

    const savedLocation = LocationManager.getActive();
    if (savedLocation) {
        currentLocation = savedLocation;
        LocationManager.setActive(savedLocation);
        Weather.loadFor(savedLocation);
        return;
    }

    const fallback = { ...CONFIG.DEFAULT_LOCATION };
    currentLocation = fallback;
    LocationManager.setActive(fallback);
    Weather.loadFor(fallback);
}

function getPosition(options = {}) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: options.timeout || 15000,
            maximumAge: 0
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

        // NEW: Track updates
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdateToast();
                }
            });
        });
    } catch (err) {
        console.warn('[SW] Registration failed:', err.message);
    }
}

// ============================================
// NEW: UPDATE TOAST
// ============================================

let pendingWorker = null;

function wireUpdateToast() {
    const reloadBtn = document.getElementById('updateReloadBtn');
    const dismissBtn = document.getElementById('updateDismissBtn');
    const toast = document.getElementById('updateToast');

    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            if (pendingWorker) pendingWorker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
        });
    }
    if (dismissBtn && toast) {
        dismissBtn.addEventListener('click', () => {
            toast.hidden = true;
        });
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!pendingWorker) return;
            window.location.reload();
        });
    }
}

function showUpdateToast() {
    const toast = document.getElementById('updateToast');
    if (!toast) return;
    toast.hidden = false;
    if (navigator.serviceWorker.controller) {
        pendingWorker = null;
        navigator.serviceWorker.getRegistration().then(reg => {
            if (reg?.waiting) pendingWorker = reg.waiting;
        });
    }
}

// ============================================
// NEW: BOTTOM NAV ACTIVE STATE
// ============================================

function wireBottomNav() {
    Bus.on('route:changed', (view) => {
        document.querySelectorAll('.bottom-nav-item').forEach(el => {
            const nav = el.dataset.nav;
            el.classList.toggle('nav-active', nav === view);
        });
    });
}

// ============================================
// NEW: PULL TO REFRESH
// ============================================

function wirePullToRefresh() {
    const indicator = document.getElementById('pullToRefresh');
    if (!indicator) return;

    let startY = 0;
    let pulling = false;
    const threshold = 80;
    const maxPull = 140;
    let currentPull = 0;

    const onTouchStart = (e) => {
        if (window.scrollY > 0) return;
        startY = e.touches[0].clientY;
        pulling = true;
        currentPull = 0;
    };

    const onTouchMove = (e) => {
        if (!pulling) return;
        const delta = e.touches[0].clientY - startY;
        if (delta <= 0) { currentPull = 0; return; }
        currentPull = Math.min(delta, maxPull);
        const progress = Math.min(currentPull / threshold, 1);
        indicator.style.transform = `translateX(-50%) translateY(${Math.min(currentPull - 40, 60)}px)`;
        indicator.querySelector('i').style.transform = `rotate(${progress * 180}deg)`;
        indicator.classList.add('is-visible');
        if (currentPull > 10) e.preventDefault();
    };

    const onTouchEnd = async () => {
        if (!pulling) return;
        pulling = false;
        if (currentPull >= threshold) {
            indicator.classList.add('is-spinning');
            try {
                await Weather.loadFor(currentLocation, { refresh: true, quiet: true });
                Toast.success('Weather updated', 1500);
            } catch {
                Toast.error('Could not refresh');
            }
            indicator.classList.remove('is-spinning');
        }
        indicator.classList.remove('is-visible');
        indicator.style.transform = '';
        indicator.querySelector('i').style.transform = '';
        currentPull = 0;
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
}

// ============================================
// NEW: HERO SHARE BUTTON
// ============================================

function wireHeroShare() {
    const btn = document.getElementById('heroShareBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        const w = AppState.get('currentWeather');
        const loc = LocationManager.getActive();
        if (!w?.current || !loc) {
            Toast.info('Weather data not ready yet');
            return;
        }

        const temp = Math.round(w.current.temperature_2m);
        const cond = describeWeather(w.current.weather_code);
        const text = `${loc.name}: ${temp}°C, ${cond} — from EmmiDev Weather`;
        const url = window.location.href;

        // Use Web Share API if available
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'EmmiDev Weather',
                    text,
                    url
                });
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;
            }
        }

        // Fallback: copy to clipboard
        try {
            await navigator.clipboard.writeText(`${text}\n${url}`);
            Toast.success('Copied to clipboard');
        } catch {
            Toast.error('Could not share');
        }
    });
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