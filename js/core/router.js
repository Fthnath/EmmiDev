/**
 * EmmiDev Weather — Client-side Router
 * Uses hash routing (works on GitHub Pages)
 */

import { Bus } from './events.js';

class Router {
    constructor() {
        this.routes = new Map();
        this.current = null;
        this.onNavigate = null;
    }

    init(onNavigate) {
        this.onNavigate = onNavigate;
        window.addEventListener('hashchange', () => this.handle());
        // Handle initial
        if (!location.hash) location.hash = '#home';
        this.handle();
    }

    register(path, viewId) {
        this.routes.set(path, viewId);
    }

    navigate(path) {
        if (!path.startsWith('#')) path = '#' + path;
        if (location.hash === path) this.handle();
        else location.hash = path;
    }

    handle() {
        const path = location.hash.replace('#', '') || 'home';
        const cleanPath = path.split('/')[0];
        const viewId = this.routes.get('#' + cleanPath) || this.routes.get(cleanPath) || cleanPath;
        
        this.current = cleanPath;
        
        // Hide all views, show current
        document.querySelectorAll('[data-view]').forEach(el => {
            el.classList.toggle('view-active', el.dataset.view === viewId);
        });
        
        // Update nav active state
        document.querySelectorAll('[data-nav]').forEach(el => {
            el.classList.toggle('nav-active', el.dataset.nav === cleanPath);
        });
        
        // Scroll to top on navigation
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (this.onNavigate) this.onNavigate(cleanPath);
        Bus.emit('route:changed', cleanPath);
    }

    go(path) {
        this.navigate(path);
    }
}

export const router = new Router();
