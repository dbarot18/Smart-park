/* ═══════════════════════════════════════════════════════
   config.js — App Constants & Configuration
═══════════════════════════════════════════════════════ */

'use strict';

const CONFIG = {

  /* ── Overpass API ── */
  OVERPASS_URL: 'https://overpass-api.de/api/interpreter',
  OVERPASS_FALLBACK_URLS: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
  ],
  OVERPASS_TIMEOUT: 25,          // seconds

  /* ── Nominatim Geocoding ── */
  NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search',

  /**
   * Optional Mapbox public token (pk…). Leave empty to use the free OSM map only.
   */
  MAPBOX_PUBLIC_TOKEN: '',

  /* ── Leaflet tile layer ── */
  LEAFLET_TILE: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  LEAFLET_ATTR: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors © <a href="https://carto.com">CARTO</a>',

  /* ── Defaults ── */
  DEFAULT_RADIUS:  1000,        // metres
  MIN_RADIUS:       200,
  MAX_RADIUS:      5000,
  DEFAULT_ZOOM:      15,
  USA_CENTER:     { lat: 39.5, lng: -98.35 },
  USA_ZOOM:           4,

  /* ── Max results shown in sidebar ── */
  MAX_LIST_RESULTS: 80,

  /* ── Mapbox style ── */
  MAPBOX_STYLE: 'mapbox://styles/mapbox/dark-v11',

  /**
   * Future: HTTP endpoint that returns live occupancy keyed by OSM id, e.g.
   * { "way/12345": { "available": 12, "total": 40 } }
   * Leave empty — the UI only shows OSM tags until you plug in a real API + backend.
   */
  OCCUPANCY_API_URL: '',
};
