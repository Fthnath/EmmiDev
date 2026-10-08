/**
 * EmmiDev Weather — Toast Notifications
 * Non-blocking messages that auto-dismiss
 */

import { create, $ } from '../utils/dom.js';

class ToastManager {
    constructor() {
        this.container = null;
        this.maxVisible = 4;
    }

    ensureContainer() {
        if (this.container && document.body.contains(this.container)) return this.container;
        this.container = create('div', { class: 'toast-container', 'aria-live': 'polite' });
        document.body.appendChild(this.container);
        return this.container;
    }

    show(message, type = 'info', duration = 3500) {
        const c = this.ensureContainer();
        
        // Trim if too many
        while (c.children.length >= this.maxVisible) {
            c.removeChild(c.firstChild);
        }
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-times-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        const toast = create('div', {
            class: `toast toast-${type}`,
            role: 'status'
        }, [
            create('i', { class: `fas ${icons[type] || icons.info}` }),
            create('span', { class: 'toast-message' }, message),
            create('button', {
                class: 'toast-close',
                'aria-label': 'Close',
                onclick: () => this.dismiss(toast)
            }, '×')
        ]);
        
        c.appendChild(toast);
        
        // Trigger animation
        requestAnimationFrame(() => toast.classList.add('toast-show'));
        
        if (duration > 0) {
            setTimeout(() => this.dismiss(toast), duration);
        }
        
        return toast;
    }

    dismiss(toast) {
        if (!toast || !toast.parentNode) return;
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 250);
    }

    success(msg, dur) { return this.show(msg, 'success', dur); }
    error(msg, dur)   { return this.show(msg, 'error', dur || 5000); }
    warning(msg, dur) { return this.show(msg, 'warning', dur); }
    info(msg, dur)    { return this.show(msg, 'info', dur); }
}

export const Toast = new ToastManager();
