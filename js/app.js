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
    selectedSlotId: null,
    radius:      CONFIG.DEFAULT_RADIUS,
    filterType:  'all',
    mapboxToken: '',
    userLocation: null,
    simTimer: null,
    bookings: {},
    favourites: new Set(),
    recentSearches: [],
    notifyWatches: {},
    streetOverlayOn: false,
    streetSegments: [],
  };

  function init() {
    _loadPersistedState();
    _bindEvents();
    document.addEventListener('ps:booked', _onExternalBooked);
    UI.showWelcome();
    UI.renderRecentSearches(state.recentSearches, _searchByText);
    _bootMap();
    _startLiveSimulation();
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
        if (state.streetOverlayOn && state.center) _reloadStreetOverlay();
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
    document.getElementById('street-toggle')
      .addEventListener('click', _onToggleStreetOverlay);

    document.getElementById('geo-btn')
      .addEventListener('click', _onUseMyLocation);

    document.getElementById('lot-list')
      .addEventListener('click', e => {
        const quickCity = e.target.closest('[data-city]');
        if (!quickCity) return;
        const city = quickCity.getAttribute('data-city');
        if (!city) return;
        document.getElementById('search-input').value = city;
        _onSearch();
      });
  }

  async function _onSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) { UI.toast('Empty search', 'Enter a city or address.', true); return; }
    if (!MapManager.isReady()) { UI.toast('Map loading', 'Wait a moment and try again.', true); return; }

    UI.toast('Searching...', `Finding parking near ${query}.`, false);
    UI.showLoading();

    try {
      const coords = await API.geocode(query, state.mapboxToken);
      if (!coords) {
        UI.toast('Not found', 'Try a different search.', true);
        UI.showEmpty();
        return;
      }

      state.center = coords;
      _pushRecentSearch(query);
      MapManager.panTo(coords.lat, coords.lng);
      MapManager.drawRadius(coords.lat, coords.lng, state.radius);

      const elements = await API.fetchParking(coords.lat, coords.lng, state.radius);
      state.lots = API.parseLots(elements, coords.lat, coords.lng);
      _applyFavouriteFlags();
      await API.enrichAvailability(state.lots);
      state.lots.forEach(_prepareLotSlots);
      state.selectedSlotId = null;
      if (state.streetOverlayOn) await _reloadStreetOverlay();

      if (!state.lots.length) {
        UI.toast('No results', 'No parking features mapped in OSM for this area. Widen the radius.', true);
        UI.showEmpty();
        MapManager.clearMarkers();
        if (state.streetOverlayOn) MapManager.clearStreetOverlay();
        return;
      }

      UI.toast(
        `${state.lots.length} lots found`,
        `Showing lots within ${Utils.formatRadius(state.radius)}.`,
        false
      );

      _refreshView();

    } catch (err) {
      console.error('[ParkSmart] Search error:', err);
      UI.toast('Connection error', err?.message || 'Could not reach the data service. Try again.', true);
      UI.showEmpty();
      if (state.streetOverlayOn) MapManager.clearStreetOverlay();
    }
  }

  function _refreshView() {
    const filtered = _getFiltered();
    UI.renderLotList(filtered, state.selectedLot, _onSelectLot, _onToggleFavourite);
    MapManager.plotMarkers(filtered, _onSelectLot, _onDirectionsByLotId);
    UI.updateHeaderStats(state.lots);
    UI.updateCityStats(state.lots);
  }

  function _getFiltered() {
    return state.lots.filter(lot => {
      switch (state.filterType) {
        case 'free':        return lot.fee === 'no';
        case 'favourites':  return lot.isFavourite;
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
    state.selectedSlotId = null;

    const lot = state.lots.find(l => l.id === lotId);
    if (!lot) return;

    MapManager.panTo(lot.lat, lot.lng);

    UI.openPanel(lot, {
      onDirections: () => _openDirectionsToLot(lot),
      onOsm:        () => { window.open(lot.osmUrl, '_blank', 'noopener,noreferrer'); },
      onClose:      _onClosePanel,
      onSelectSlot: slotId => _onPickSlot(lot, slotId),
      onReserve: () => _onReserveSlot(lot),
      onNotify: () => _onNotifyWhenFree(lot),
      onToggleFavourite: () => _onToggleFavourite(lot.id),
      selectedSlotId: state.selectedSlotId,
    });
    if (typeof SlotReservation !== 'undefined' && SlotReservation.init) {
      SlotReservation.init(lot);
    }
    if (window.innerWidth <= 820) {
      document.getElementById('map-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

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
    state.selectedSlotId = null;
    UI.closePanel();
    _refreshView();
  }

  function _prepareLotSlots(lot) {
    const total = Number.isFinite(lot.capacity) && lot.capacity > 0
      ? lot.capacity
      : Utils.randInt(24, 72);
    if (!Array.isArray(lot.slots) || lot.slots.length !== total) {
      lot.slots = Array.from({ length: total }, (_, idx) => ({
        id: idx + 1,
        status: 'taken',
      }));
    }
    _syncSlotsToAvailability(lot);
  }

  function _syncSlotsToAvailability(lot) {
    if (!Array.isArray(lot.slots) || !lot.slots.length) return;
    const total = lot.slots.length;
    const reserved = Math.max(0, Math.round(total * 0.08));
    const booked = Math.max(0, Math.round(total * 0.05));
    const maxFree = Math.max(0, total - reserved - booked);
    const free = Number.isFinite(lot.availableSpots)
      ? Utils.clamp(lot.availableSpots, 0, maxFree)
      : Math.round(maxFree * 0.25);
    const taken = Math.max(0, total - reserved - booked - free);

    const bucket = [];
    for (let i = 0; i < free; i++) bucket.push('free');
    for (let i = 0; i < taken; i++) bucket.push('taken');
    for (let i = 0; i < reserved; i++) bucket.push('reserved');
    for (let i = 0; i < booked; i++) bucket.push('booked');

    for (let i = bucket.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = bucket[i];
      bucket[i] = bucket[j];
      bucket[j] = tmp;
    }

    lot.slots.forEach((slot, idx) => {
      const bookingKey = `${lot.id}:${slot.id}`;
      if (state.bookings[bookingKey]) {
        slot.status = 'booked';
      } else {
        slot.status = bucket[idx] || 'taken';
      }
    });
  }

  function _onPickSlot(lot, slotId) {
    const slot = lot.slots.find(s => s.id === slotId);
    if (!slot || slot.status !== 'free') return;
    state.selectedSlotId = slotId;
    UI.openPanel(lot, {
      onDirections: () => _openDirectionsToLot(lot),
      onOsm:        () => { window.open(lot.osmUrl, '_blank', 'noopener,noreferrer'); },
      onClose:      _onClosePanel,
      onSelectSlot: id => _onPickSlot(lot, id),
      onReserve: () => _onReserveSlot(lot),
      onNotify: () => _onNotifyWhenFree(lot),
      onToggleFavourite: () => _onToggleFavourite(lot.id),
      selectedSlotId: state.selectedSlotId,
    });
  }

  function _onReserveSlot(lot) {
    if (!state.selectedSlotId) {
      UI.toast('Pick a slot', 'Select a free slot before reserving.', true);
      return;
    }
    const slot = lot.slots.find(s => s.id === state.selectedSlotId);
    if (!slot || slot.status !== 'free') {
      UI.toast('Slot unavailable', 'Choose another free slot.', true);
      return;
    }

    UI.openReserveModal(lot, slot, ({ plate }) => {
      const key = `${lot.id}:${slot.id}`;
      state.bookings[key] = {
        plate,
        ts: Date.now(),
      };
      slot.status = 'booked';
      if (Number.isFinite(lot.availableSpots)) {
        lot.availableSpots = Math.max(0, lot.availableSpots - 1);
      }
      state.selectedSlotId = null;
      UI.toast('Reservation confirmed', `${lot.name} · Slot ${slot.id} · ${plate}`, false);
      _refreshView();
      _onSelectLot(lot.id);
    });
  }

  async function _onUseMyLocation() {
    if (!MapManager.isReady()) {
      UI.toast('Map loading', 'Wait a moment and try again.', true);
      return;
    }
    UI.showLoading();
    try {
      const pos = await _getCurrentLocation();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      state.center = { lat, lng, label: 'My location' };
      document.getElementById('search-input').value = 'Near me';
      MapManager.panTo(lat, lng);
      MapManager.drawRadius(lat, lng, state.radius);
      const elements = await API.fetchParking(lat, lng, state.radius);
      state.lots = API.parseLots(elements, lat, lng);
      _applyFavouriteFlags();
      await API.enrichAvailability(state.lots);
      state.lots.forEach(_prepareLotSlots);
      if (state.streetOverlayOn) await _reloadStreetOverlay();
      UI.toast(`${state.lots.length} lots nearby`, 'Using your current location.', false);
      _refreshView();
    } catch (err) {
      UI.toast('Location unavailable', 'Allow location permissions and try again.', true);
      UI.showEmpty();
      if (state.streetOverlayOn) MapManager.clearStreetOverlay();
    }
  }

  function _startLiveSimulation() {
    if (state.simTimer) clearInterval(state.simTimer);
    state.simTimer = setInterval(() => {
      if (!state.lots.length) return;
      state.lots.forEach(lot => {
        if (!Number.isFinite(lot.availableSpots)) return;
        const delta = Utils.randInt(-2, 2);
        lot.availableSpots = Math.max(0, lot.availableSpots + delta);
        if (lot.availabilitySource !== 'live') {
          lot.availabilitySource = 'simulated';
        }
        _syncSlotsToAvailability(lot);
        _checkNotifyWatch(lot);
      });

      if (state.selectedLot != null) {
        const lot = state.lots.find(l => l.id === state.selectedLot);
        if (lot) {
          UI.openPanel(lot, {
            onDirections: () => _openDirectionsToLot(lot),
            onOsm:        () => { window.open(lot.osmUrl, '_blank', 'noopener,noreferrer'); },
            onClose:      _onClosePanel,
            onSelectSlot: id => _onPickSlot(lot, id),
            onReserve: () => _onReserveSlot(lot),
            onNotify: () => _onNotifyWhenFree(lot),
            onToggleFavourite: () => _onToggleFavourite(lot.id),
            selectedSlotId: state.selectedSlotId,
          });
          if (typeof SlotReservation !== 'undefined' && SlotReservation.refresh) {
            SlotReservation.refresh();
          }
        }
      }
      _refreshView();
    }, 15000);
  }

  function _onToggleFavourite(lotId) {
    const lot = state.lots.find(l => l.id === lotId);
    if (!lot) return;
    const key = `${lot.osmType}/${lot.osmRef}`;
    if (state.favourites.has(key)) state.favourites.delete(key);
    else state.favourites.add(key);
    _applyFavouriteFlags();
    _savePersistedState();
    _refreshView();
  }

  function _onNotifyWhenFree(lot) {
    const key = `${lot.osmType}/${lot.osmRef}`;
    state.notifyWatches[key] = { lotName: lot.name, armedAt: Date.now() };
    _savePersistedState();
    UI.toast('Notification armed', `We will alert you when ${lot.name} has free spots.`, false);
  }

  function _checkNotifyWatch(lot) {
    const key = `${lot.osmType}/${lot.osmRef}`;
    if (!state.notifyWatches[key]) return;
    if (Number.isFinite(lot.availableSpots) && lot.availableSpots > 0) {
      UI.toast('Spot available', `${lot.name} now has ${lot.availableSpots} free spots.`, false);
      delete state.notifyWatches[key];
      _savePersistedState();
    }
  }

  async function _onToggleStreetOverlay() {
    state.streetOverlayOn = !state.streetOverlayOn;
    const btn = document.getElementById('street-toggle');
    btn.classList.toggle('on', state.streetOverlayOn);
    if (!state.streetOverlayOn) {
      MapManager.clearStreetOverlay();
      return;
    }
    await _reloadStreetOverlay();
  }

  async function _reloadStreetOverlay() {
    if (!state.center) return;
    try {
      const elements = await API.fetchStreetParking(state.center.lat, state.center.lng, state.radius);
      state.streetSegments = API.parseStreetParking(elements, state.center.lat, state.center.lng);
      MapManager.plotStreetOverlay(state.streetSegments);
      UI.toast('Street overlay', `${state.streetSegments.length} street parking segments found.`, false);
    } catch (_) {
      UI.toast('Overlay unavailable', 'Could not load street parking overlay right now.', true);
    }
  }

  function _searchByText(text) {
    document.getElementById('search-input').value = text;
    _onSearch();
  }

  function _pushRecentSearch(query) {
    const cleaned = query.trim();
    if (!cleaned) return;
    state.recentSearches = [cleaned, ...state.recentSearches.filter(x => x.toLowerCase() !== cleaned.toLowerCase())].slice(0, 6);
    UI.renderRecentSearches(state.recentSearches, _searchByText);
    _savePersistedState();
  }

  function _applyFavouriteFlags() {
    state.lots.forEach(lot => {
      const key = `${lot.osmType}/${lot.osmRef}`;
      lot.isFavourite = state.favourites.has(key);
    });
  }

  function _loadPersistedState() {
    try {
      const raw = localStorage.getItem('parksmart-state-v1');
      if (!raw) return;
      const data = JSON.parse(raw);
      state.favourites = new Set(Array.isArray(data.favourites) ? data.favourites : []);
      state.recentSearches = Array.isArray(data.recentSearches) ? data.recentSearches.slice(0, 6) : [];
      state.notifyWatches = data.notifyWatches && typeof data.notifyWatches === 'object' ? data.notifyWatches : {};
    } catch (_) {
      // ignore invalid persisted state
    }
  }

  function _savePersistedState() {
    localStorage.setItem('parksmart-state-v1', JSON.stringify({
      favourites: Array.from(state.favourites),
      recentSearches: state.recentSearches,
      notifyWatches: state.notifyWatches,
    }));
  }

  function _onExternalBooked(e) {
    const detail = e?.detail;
    if (!detail) return;
    const lot = state.lots.find(l => String(l.id) === String(detail.lotId));
    if (!lot) return;
    const slot = lot.slots?.find(s => String(s.id) === String(detail.slotId));
    if (slot) slot.status = 'booked';
    const key = `${lot.id}:${detail.slotId}`;
    state.bookings[key] = {
      plate: detail.plate,
      name: detail.name || '',
      duration: detail.duration || 2,
      ref: detail.ref || '',
      ts: Date.now(),
    };
    if (Number.isFinite(lot.availableSpots)) {
      lot.availableSpots = Math.max(0, lot.availableSpots - 1);
    }
    UI.toast('Reservation confirmed', `${lot.name} · Slot ${detail.slotId} · ${detail.plate}`, false);
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
