export function formatTemp(value, unit = 'C', decimals = 0) {
    if (value == null || isNaN(value)) return '--';
    let v = value;
    if (unit === 'F') v = value * 9 / 5 + 32;
    return `${v.toFixed(decimals)}°${unit}`;
}
export function formatWind(value, unit = 'metric') {
    if (value == null) return '--';
    if (unit === 'imperial') return `${value.toFixed(1)} mph`;
    return `${(value * 3.6).toFixed(1)} km/h`;
}
export function formatDistance(meters, unit = 'metric') {
    if (meters == null) return '--';
    if (unit === 'imperial') return `${(meters / 1609.34).toFixed(1)} mi`;
    return `${(meters / 1000).toFixed(1)} km`;
}
export function formatPressure(hPa) {
    if (hPa == null) return '--';
    return `${Math.round(hPa)} hPa`;
}
export function formatPercent(value, decimals = 0) {
    if (value == null) return '--';
    return `${value.toFixed(decimals)}%`;
}
export function formatHumidity(value) { return formatPercent(value); }
export function formatRain(mm, unit = 'metric') {
    if (mm == null) return '--';
    if (unit === 'imperial') return `${(mm / 25.4).toFixed(2)} in`;
    return `${mm.toFixed(1)} mm`;
}
export function formatNumber(value, decimals = 0) {
    if (value == null || isNaN(value)) return '--';
    return Number(value).toFixed(decimals);
}
export function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
export function formatCoord(lat, lon) {
    const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
    return `${latStr}, ${lonStr}`;
}
export function windDirection(degrees) {
    if (degrees == null) return '--';
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(degrees / 22.5) % 16];
}
