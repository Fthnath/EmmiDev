export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function create(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') {
            el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset' && typeof v === 'object') {
            Object.assign(el.dataset, v);
        } else {
            el.setAttribute(k, v);
        }
    });
    const kids = Array.isArray(children) ? children : [children];
    kids.forEach(child => {
        if (child == null) return;
        if (typeof child === 'string') el.appendChild(document.createTextNode(child));
        else el.appendChild(child);
    });
    return el;
}

export function on(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    return () => target.removeEventListener(event, handler, options);
}

export function show(el) { if (el) el.style.display = ''; }
export function hide(el) { if (el) el.style.display = 'none'; }
export function toggle(el, state) { if (el) el.style.display = state ? '' : 'none'; }

export function debounce(fn, wait = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

export function throttle(fn, limit = 200) {
    let last = 0;
    return function(...args) {
        const now = Date.now();
        if (now - last >= limit) { last = now; fn.apply(this, args); }
    };
}
