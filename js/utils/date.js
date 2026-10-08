export function now() { return new Date(); }
export function fromUnix(seconds) { return new Date(seconds * 1000); }
export function formatTime(date, locale = 'en-US', hour12 = true) {
    return new Date(date).toLocaleTimeString(locale, {
        hour: '2-digit', minute: '2-digit', hour12
    });
}
export function formatDate(date, locale = 'en-US', opts = {}) {
    return new Date(date).toLocaleDateString(locale, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...opts
    });
}
export function formatDay(date, locale = 'en-US') {
    return new Date(date).toLocaleDateString(locale, { weekday: 'short' });
}
export function formatShort(date, locale = 'en-US') {
    return new Date(date).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}
export function isToday(date) {
    const d = new Date(date); const t = new Date();
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
}
export function isNight(sunrise, sunset, when = new Date()) {
    const t = new Date(when).getTime();
    return t < new Date(sunrise).getTime() || t > new Date(sunset).getTime();
}
export function relativeTime(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}
