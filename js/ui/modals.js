/**
 * EmmiDev Weather — Modal Manager
 * Reusable dialog system with focus trapping
 */

import { create, $ } from '../utils/dom.js';

class ModalManager {
    constructor() {
        this.stack = [];
        this.backdropEl = null;
    }

    ensureBackdrop() {
        if (this.backdropEl && document.body.contains(this.backdropEl)) return this.backdropEl;
        this.backdropEl = create('div', {
            class: 'modal-backdrop',
            onclick: (e) => {
                if (e.target === this.backdropEl) this.closeTop();
            }
        });
        document.body.appendChild(this.backdropEl);
        return this.backdropEl;
    }

    open({ title, content, actions = [], size = 'md', onClose }) {
        const backdrop = this.ensureBackdrop();
        
        const sizes = { sm: '380px', md: '520px', lg: '720px', xl: '960px' };
        
        const closeBtn = create('button', {
            class: 'modal-close',
            'aria-label': 'Close',
            onclick: () => this.closeTop()
        }, '×');
        
        const header = create('div', { class: 'modal-header' }, [
            create('h3', { class: 'modal-title' }, title || ''),
            closeBtn
        ]);
        
        const body = create('div', { class: 'modal-body' });
        if (typeof content === 'string') body.innerHTML = content;
        else if (content instanceof Node) body.appendChild(content);
        
        const footer = actions.length ? create('div', { class: 'modal-footer' },
            actions.map(a => create('button', {
                class: `btn ${a.class || 'btn-secondary'}`,
                onclick: () => {
                    const result = a.onClick ? a.onClick() : undefined;
                    if (result !== false && a.close !== false) this.closeTop();
                }
            }, a.label))
        ) : null;
        
        const modal = create('div', {
            class: `modal modal-${size}`,
            role: 'dialog',
            'aria-modal': 'true',
            style: { maxWidth: sizes[size] || sizes.md }
        }, [header, body, footer]);
        
        const wrapper = create('div', { class: 'modal-wrapper' }, modal);
        backdrop.appendChild(wrapper);
        
        requestAnimationFrame(() => {
            backdrop.classList.add('modal-active');
            wrapper.classList.add('modal-wrapper-active');
        });
        
        this.stack.push({ modal, wrapper, backdrop, onClose });
        
        // ESC to close
        this._escHandler = (e) => {
            if (e.key === 'Escape') this.closeTop();
        };
        document.addEventListener('keydown', this._escHandler);
        
        return { modal, body };
    }

    closeTop() {
        const item = this.stack.pop();
        if (!item) return;
        
        item.wrapper.classList.remove('modal-wrapper-active');
        item.backdrop.classList.remove('modal-active');
        
        setTimeout(() => {
            if (item.wrapper.parentNode) item.wrapper.parentNode.removeChild(item.wrapper);
            if (item.onClose) item.onClose();
            
            // Hide backdrop if no more modals
            if (this.stack.length === 0 && this.backdropEl) {
                this.backdropEl.classList.remove('modal-active');
            }
        }, 250);
        
        if (this.stack.length === 0) {
            document.removeEventListener('keydown', this._escHandler);
        }
    }

    closeAll() {
        while (this.stack.length) this.closeTop();
    }

    confirm(message, { title = 'Confirm', confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
        return new Promise((resolve) => {
            this.open({
                title,
                content: `<p>${message}</p>`,
                actions: [
                    { label: cancelLabel, class: 'btn-secondary', onClick: () => resolve(false) },
                    { label: confirmLabel, class: 'btn-primary', onClick: () => resolve(true) }
                ],
                onClose: () => resolve(false)
            });
        });
    }

    alert(message, { title = 'Notice' } = {}) {
        return new Promise((resolve) => {
            this.open({
                title,
                content: `<p>${message}</p>`,
                actions: [
                    { label: 'OK', class: 'btn-primary', onClick: () => resolve(true) }
                ],
                onClose: () => resolve(true)
            });
        });
    }
}

export const Modal = new ModalManager();
