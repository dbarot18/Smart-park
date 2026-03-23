/* ═══════════════════════════════════════════════════════
   utils.js — Pure utility functions (no DOM, no state)
═══════════════════════════════════════════════════════ */

'use strict';

const Utils = (() => {

  /**
   * Haversine distance between two lat/lng points (returns metres).
   */
  function haversine(lat1, lng1, lat2, lng2) {
    const R    = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2
               + Math.cos(lat1 * Math.PI / 180)
               * Math.cos(lat2 * Math.PI / 180)
               * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Format metres into a human-readable distance string.
   */
  function formatDist(metres) {
    return metres < 1000
      ? `${Math.round(metres)} m`
      : `${(metres / 1000).toFixed(1)} km`;
  }

  /**
   * Format a radius value (metres) for the slider label.
   */
  function formatRadius(metres) {
    return metres >= 1000
      ? `${(metres / 1000).toFixed(1)} km`
      : `${metres} m`;
  }

  /**
   * Random integer between min and max (inclusive).
   */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Pick a random element from an array.
   */
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Escape text for safe insertion into HTML.
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Marker colour from availability if present, else fee tag.
   */
  function lotMarkerColor(lot) {
    if (Number.isFinite(lot.availableSpots)) {
      if (lot.availableSpots > 20) return '#00e5a0';
      if (lot.availableSpots > 5)  return '#ffc53d';
      return '#ff6b6b';
    }
    if (lot.fee === 'no')  return '#00e5a0';
    if (lot.fee === 'yes') return '#ffc53d';
    return '#6b7a99';
  }

  /**
   * Human-readable fee label.
   */
  function feeLabel(fee) {
    if (fee === 'no')  return 'Free (mapped)';
    if (fee === 'yes') return 'Paid (mapped)';
    return 'Unknown';
  }

  /**
   * Infer a display name for a lot when OSM has no name tag.
   */
  function inferName(tags, index) {
    const type = tags.parking || tags.amenity || 'parking';
    const label =
      type === 'multi-storey' ? 'Multi-Storey Parking' :
      type === 'underground'  ? 'Underground Parking'  :
      type === 'surface'      ? 'Surface Lot'          :
      'Parking';
    return `${label} #${index + 1}`;
  }

  /**
   * Get a type icon emoji for a parking lot.
   */
  function typeIcon(parkingType) {
    return parkingType === 'multi-storey' ? '🏢' :
           parkingType === 'underground'  ? '⬇️'  : '🅿';
  }

  /**
   * Clamp a value between min and max.
   */
  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  /**
   * Debounce a function call.
   */
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  return {
    haversine,
    formatDist,
    formatRadius,
    randInt,
    pick,
    inferName,
    typeIcon,
    escapeHtml,
    lotMarkerColor,
    feeLabel,
    clamp,
    debounce,
  };

})();
