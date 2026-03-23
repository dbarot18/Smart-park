/* ═══════════════════════════════════════════════════════
   app.js — Main Application Controller
   Data: real OSM features only (no simulated slot occupancy).
═══════════════════════════════════════════════════════ */

'use strict';

const App = (() => {

  const state = {
    lots:        [],
    center:      null,
    selectedLot: null,
    radius:      CONFIG.DEFAULT_RADIUS,
    filterType:  'all',
    mapboxToken: '',
    userLocation: null,
  };

  function init() {
    _bindEvents();
    UI.showWelcome();
    _bootMap();
  }

  function _bootMap() {
    const token = typeof CONFIG.MAPBOX_PUBLIC_TOKEN === 'string'
      ? CONFIG.MAPBOX_PUBLIC_TOKEN.trim()
      : '';

    if (token) {
      state.mapboxToken = token;
      MapManager.loadMapbox(
        token,
        () => {
          UI.toast('Map ready', 'Search a US place to load mapped parking from OpenStreetMap.', false);
        },
        () => UI.toast('Map error', 'Check MAPBOX_PUBLIC_TOKEN in js/config.js.', true)
      );
    } else {
      MapManager.loadLeaflet(() => {
        UI.toast('Map ready', 'Search a US place to load mapped parking from OpenStreetMap.', false);
      });
    }
  }

  function _bindEvents() {
    document.getElementById('search-btn')
      .addEventListener('click', _onSearch);
    document.getElementById('search-input')
      .addEventListener('keydown', e => { if (e.key === 'Enter') _onSearch(); });

    document.getElementById('radius-slider')
      .addEventListener('input', e => {
        state.radius = Number(e.target.value);
        UI.updateRadiusLabel(state.radius);
        if (state.center) MapManager.drawRadius(state.center.lat, state.center.lng, state.radius);
      });

    document.getElementById('filter-chips')
      .addEventListener('click', e => {
        const chip = e.target.closest('.fchip');
        if (!chip) return;
        document.querySelectorAll('.fchip').forEach(c => c.classList.remove('on'));
        chip.classList.add('on');
        state.filterType = chip.dataset.filter;
        _refreshView();
      });

    document.getElementById('refresh-btn')
      .addEventListener('click', _onSearch);
  }

  async function _onSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) { UI.toast('Empty search', 'Enter a city or address.', true); return; }
    if (!MapManager.isReady()) { UI.toast('Map loading', 'Wait a moment and try again.', true); return; }

    UI.showLoading();

    try {
      const coords = await API.geocode(query, state.mapboxToken);
      if (!coords) {
        UI.toast('Not found', 'Try a different search.', true);
        UI.showEmpty();
        return;
      }

      state.center = coords;
      MapManager.panTo(coords.lat, coords.lng);
      MapManager.drawRadius(coords.lat, coords.lng, state.radius);

      const elements = await API.fetchParking(coords.lat, coords.lng, state.radius);
      state.lots = API.parseLots(elements, coords.lat, coords.lng);
      await API.enrichAvailability(state.lots);

      if (!state.lots.length) {
        UI.toast('No results', 'No parking features mapped in OSM for this area. Widen the radius.', true);
        UI.showEmpty();
        MapManager.clearMarkers();
        return;
      }

      UI.toast(
        `${state.lots.length} locations`,
        `From OpenStreetMap within ${Utils.formatRadius(state.radius)}. Verify on site before parking.`,
        false
      );

      _refreshView();

    } catch (err) {
      console.error('[ParkSmart] Search error:', err);
      UI.toast('Connection error', err?.message || 'Could not reach the data service. Try again.', true);
      UI.showEmpty();
    }
  }

  function _refreshView() {
    const filtered = _getFiltered();
    UI.renderLotList(filtered, state.selectedLot, _onSelectLot);
    MapManager.plotMarkers(filtered, _onSelectLot, _onDirectionsByLotId);
    UI.updateHeaderStats(state.lots);
  }

  function _getFiltered() {
    return state.lots.filter(lot => {
      switch (state.filterType) {
        case 'free':        return lot.fee === 'no';
        case 'available':   return Number.isFinite(lot.availableSpots) && lot.availableSpots > 0;
        case 'multistorey': return lot.parkingType === 'multi-storey';
        case 'underground': return lot.parkingType === 'underground';
        case 'surface':     return ['surface', 'parking'].includes(lot.parkingType);
        case 'disabled':    return lot.disabledSpaces > 0;
        default:            return true;
      }
    });
  }

  function _onSelectLot(lotId) {
    state.selectedLot = lotId;

    const lot = state.lots.find(l => l.id === lotId);
    if (!lot) return;

    MapManager.panTo(lot.lat, lot.lng);

    UI.openPanel(lot, {
      onDirections: () => _openDirectionsToLot(lot),
      onOsm:        () => { window.open(lot.osmUrl, '_blank', 'noopener,noreferrer'); },
      onClose:      _onClosePanel,
    });

    _refreshView();
    setTimeout(UI.scrollToActiveCard, 60);
  }

  function _onDirectionsByLotId(lotId) {
    const lot = state.lots.find(l => l.id === lotId);
    if (!lot) return;
    // Open Google Maps immediately on user click to avoid blank tab.
    MapManager.openDirections(lot.lat, lot.lng);
  }

  function _onClosePanel() {
    state.selectedLot = null;
    UI.closePanel();
    _refreshView();
  }

  async function _openDirectionsToLot(lot, navWindow) {
    const cached = state.userLocation;
    if (cached) {
      MapManager.openDirections(lot.lat, lot.lng, cached.lat, cached.lng, navWindow);
      return;
    }

    try {
      const pos = await _getCurrentLocation();
      state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      MapManager.openDirections(
        lot.lat,
        lot.lng,
        state.userLocation.lat,
        state.userLocation.lng,
        navWindow
      );
    } catch (_) {
      UI.toast('Location unavailable', 'Could not access your current location. Opened destination-only directions.', true);
      MapManager.openDirections(lot.lat, lot.lng, undefined, undefined, navWindow);
    }
  }

  function _getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      });
    });
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', App.init);
