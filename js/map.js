/* ═══════════════════════════════════════════════════════
  map.js — Map initialisation & marker management
  Supports: Mapbox GL JS + Leaflet/OSM
═══════════════════════════════════════════════════════ */

'use strict';

const MapManager = (() => {

  function _escapeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let _map          = null;
  let _markers      = [];
  let _streetMarkers = [];
  let _radiusCircle = null;
  let _useMapbox    = false;
  let _mapboxToken  = '';
  let _onDirectionsAskCb = null;
  let _popupDelegationBound = false;

  /* ────────────────────────────────────────────
     INIT
  ──────────────────────────────────────────── */

  /**
   * Load Mapbox GL JS dynamically, then initialize the map.
   */
  function loadMapbox(accessToken, onReady, onError) {
    _useMapbox = true;
    _mapboxToken = accessToken;

    const initMapbox = () => {
      mapboxgl.accessToken = _mapboxToken;
      _map = new mapboxgl.Map({
        container: 'gmap',
        style: CONFIG.MAPBOX_STYLE,
        center: [CONFIG.USA_CENTER.lng, CONFIG.USA_CENTER.lat],
        zoom: CONFIG.USA_ZOOM,
      });

      _map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
      _map.once('error', () => {
        if (onError) onError();
      });
      _map.on('load', () => {
        if (onReady) onReady();
      });
    };

    if (window.mapboxgl) {
      initMapbox();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.js';
    script.onload = initMapbox;
    script.onerror = () => { if (onError) onError(); };
    document.head.appendChild(script);
  }

  /**
   * Load Leaflet (OSM) dynamically.
   */
  function loadLeaflet(onReady) {
    _useMapbox = false;

    // CSS
    const link = document.createElement('link');
    link.rel   = 'stylesheet';
    link.href  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(link);

    // JS
    const script   = document.createElement('script');
    script.src     = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    script.onload  = () => {
      _map = L.map('gmap', { zoomControl: true })
               .setView([CONFIG.USA_CENTER.lat, CONFIG.USA_CENTER.lng], CONFIG.USA_ZOOM);

      L.tileLayer(CONFIG.LEAFLET_TILE, {
        attribution: CONFIG.LEAFLET_ATTR,
        maxZoom:     19,
      }).addTo(_map);

      if (onReady) onReady();
    };
    document.head.appendChild(script);
  }

  /* ────────────────────────────────────────────
     NAVIGATION
  ──────────────────────────────────────────── */

  function panTo(lat, lng, zoom) {
    if (!_map) return;
    const z = zoom ?? CONFIG.DEFAULT_ZOOM;
    if (_useMapbox) {
      _map.flyTo({ center: [lng, lat], zoom: z, essential: true });
    } else {
      _map.setView([lat, lng], z);
    }
  }

  /* ────────────────────────────────────────────
     RADIUS CIRCLE
  ──────────────────────────────────────────── */

  function drawRadius(lat, lng, radiusM) {
    if (!_map) return;
    _clearRadius();

    if (_useMapbox) {
      const circleFeature = _buildRadiusFeature(lat, lng, radiusM);
      const sourceId = 'search-radius';
      const fillId = 'search-radius-fill';
      const lineId = 'search-radius-line';

      if (_map.getLayer(fillId)) _map.removeLayer(fillId);
      if (_map.getLayer(lineId)) _map.removeLayer(lineId);
      if (_map.getSource(sourceId)) _map.removeSource(sourceId);

      _map.addSource(sourceId, { type: 'geojson', data: circleFeature });
      _map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#00e5a0',
          'fill-opacity': 0.06,
        },
      });
      _map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#00e5a0',
          'line-opacity': 0.35,
          'line-width': 1,
        },
      });
      _radiusCircle = { sourceId, fillId, lineId };
    } else {
      _radiusCircle = L.circle([lat, lng], {
        radius:      radiusM,
        color:       '#00e5a0',
        fillColor:   '#00e5a0',
        fillOpacity: 0.04,
        weight:      1,
        opacity:     0.35,
      }).addTo(_map);
    }
  }

  function _clearRadius() {
    if (!_radiusCircle) return;
    if (_useMapbox) {
      if (_map.getLayer(_radiusCircle.fillId)) _map.removeLayer(_radiusCircle.fillId);
      if (_map.getLayer(_radiusCircle.lineId)) _map.removeLayer(_radiusCircle.lineId);
      if (_map.getSource(_radiusCircle.sourceId)) _map.removeSource(_radiusCircle.sourceId);
    } else {
      _radiusCircle.remove();
    }
    _radiusCircle = null;
  }

  /* ────────────────────────────────────────────
     MARKERS
  ──────────────────────────────────────────── */

  /**
   * Plot an array of lot objects as map markers.
   * @param {Array}    lots            Lot objects
   * @param {Function} onSelect        Callback(lotId) when marker is clicked
   * @param {Function} onDirectionsAsk Callback(lotId) when user confirms directions
   */
  function plotMarkers(lots, onSelect, onDirectionsAsk) {
    _onDirectionsAskCb = onDirectionsAsk;
    _ensurePopupDelegation();
    clearMarkers();

    lots.forEach(lot => {
      const color = Utils.lotMarkerColor(lot);

      if (_useMapbox) {
        _addMapboxMarker(lot, color, onSelect, onDirectionsAsk);
      } else {
        _addLeafletMarker(lot, color, onSelect, onDirectionsAsk);
      }
    });
  }

  function _markerHtml(lot, color) {
    const knownAvail = Number.isFinite(lot.availableSpots);
    const badge = knownAvail
      ? `${lot.availabilitySource === 'estimated' ? '~' : ''}${lot.availableSpots}`
      : '?';
    const capHint = knownAvail
      ? `${lot.availableSpots} spots available (${lot.availabilitySource})`
      : 'Availability unknown';
    const feeLine = lot.fee === 'yes'
      ? 'Paid parking'
      : lot.fee === 'no'
        ? 'Free parking'
        : 'Fee unknown';
    const safeName = _escapeAttr(lot.name);
    return `
      <div class="ps-marker" role="button" tabindex="0" data-lot-id="${lot.id}"
        title="${safeName} — ${capHint}"
        aria-label="Parking: ${safeName}, ${capHint}">
        <div class="ps-marker-dot" style="background:${color};box-shadow:0 0 10px ${color}99">
          <span class="ps-marker-p">P</span>
        </div>
        <span class="ps-marker-badge">${badge}</span>
        <span class="ps-marker-sub">avail</span>
        <div class="ps-hover-pop" role="dialog" aria-label="Parking action">
          <div class="ps-pop-line ps-pop-title">${safeName}</div>
          <div class="ps-pop-line">${_escapeAttr(feeLine)}</div>
          <div class="ps-pop-line">Want directions?</div>
          <div class="ps-pop-actions">
            <button type="button" class="ps-pop-btn yes" data-action="dir-yes">Yes</button>
            <button type="button" class="ps-pop-btn no" data-action="dir-no">No</button>
          </div>
        </div>
      </div>`;
  }

  function _ensurePopupDelegation() {
    if (_popupDelegationBound) return;
    const mapEl = document.getElementById('gmap');
    if (!mapEl) return;

    mapEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const markerEl = btn.closest('.ps-marker');
      if (!markerEl) return;

      e.preventDefault();
      e.stopPropagation();

      const action = btn.getAttribute('data-action');
      if (action === 'dir-no') {
        markerEl.classList.remove('popup-open');
        return;
      }

      if (action === 'dir-yes' && _onDirectionsAskCb) {
        const lotId = Number(markerEl.dataset.lotId);
        if (Number.isFinite(lotId)) _onDirectionsAskCb(lotId);
      }
    }, true);

    _popupDelegationBound = true;
  }

  function _wireMarkerInteractions(el, lot, onSelect, onDirectionsAsk) {
    el.addEventListener('mouseenter', () => el.classList.add('popup-open'));
    el.addEventListener('mouseleave', () => el.classList.remove('popup-open'));
    el.addEventListener('focusin', () => el.classList.add('popup-open'));
    el.addEventListener('focusout', () => el.classList.remove('popup-open'));
  }

  function _addMapboxMarker(lot, color, onSelect, onDirectionsAsk) {
    const wrap = document.createElement('div');
    wrap.innerHTML = _markerHtml(lot, color).trim();
    const el = wrap.firstElementChild;
    _wireMarkerInteractions(el, lot, onSelect, onDirectionsAsk);
    el.addEventListener('click', e => { e.stopPropagation(); onSelect(lot.id); });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(lot.id);
      }
    });

    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lot.lng, lot.lat])
      .setOffset([0, -6])
      .addTo(_map);

    _markers.push(marker);
  }

  function _addLeafletMarker(lot, color, onSelect, onDirectionsAsk) {
    const icon = L.divIcon({
      className: 'ps-marker-leaflet-root',
      html: _markerHtml(lot, color),
      iconSize:   [44, 52],
      iconAnchor: [22, 48],
    });

    const marker = L.marker([lot.lat, lot.lng], { icon })
      .addTo(_map)
      .on('click', () => onSelect(lot.id));

    marker.on('add', () => {
      const markerEl = marker.getElement()?.querySelector('.ps-marker');
      if (markerEl) _wireMarkerInteractions(markerEl, lot, onSelect, onDirectionsAsk);
    });

    _markers.push(marker);
  }

  function clearMarkers() {
    _markers.forEach(m => {
      m.remove();
    });
    _markers = [];
  }

  function plotStreetOverlay(items) {
    clearStreetOverlay();
    (items || []).forEach(item => {
      if (_useMapbox) {
        const el = document.createElement('div');
        el.className = 'street-pin';
        el.title = `${item.label} (${item.lane})`;
        el.textContent = 'S';
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([item.lng, item.lat])
          .addTo(_map);
        _streetMarkers.push(marker);
      } else {
        const icon = L.divIcon({
          className: 'street-pin-leaflet',
          html: '<div class="street-pin">S</div>',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const marker = L.marker([item.lat, item.lng], { icon }).addTo(_map);
        marker.bindTooltip(`${item.label} (${item.lane})`, { direction: 'top' });
        _streetMarkers.push(marker);
      }
    });
  }

  function clearStreetOverlay() {
    _streetMarkers.forEach(m => m.remove());
    _streetMarkers = [];
  }

  /* ────────────────────────────────────────────
     DIRECTIONS
  ──────────────────────────────────────────── */

  function openDirections(destLat, destLng, originLat, originLng, targetWindow) {
    const params = new URLSearchParams({
      api: '1',
      destination: `${destLat},${destLng}`,
      travelmode: 'driving',
    });
    if (Number.isFinite(originLat) && Number.isFinite(originLng)) {
      params.set('origin', `${originLat},${originLng}`);
    }

    const url = `https://www.google.com/maps/dir/?${params.toString()}`;
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.href = url;
      return;
    }
    window.open(url, '_blank');
  }

  function _buildRadiusFeature(lat, lng, radiusM) {
    const points = 64;
    const coords = [];
    const earthRadius = 6378137;
    const latRad = lat * Math.PI / 180;

    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * (Math.PI * 2);
      const dx = radiusM * Math.cos(angle);
      const dy = radiusM * Math.sin(angle);

      const pointLat = lat + (dy / earthRadius) * (180 / Math.PI);
      const pointLng = lng + (dx / (earthRadius * Math.cos(latRad))) * (180 / Math.PI);
      coords.push([pointLng, pointLat]);
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coords],
      },
      properties: {},
    };
  }

  /* ────────────────────────────────────────────
     STATE
  ──────────────────────────────────────────── */

  function isReady()    { return _map !== null; }
  function usesMapbox() { return _useMapbox; }

  return {
    loadMapbox,
    loadLeaflet,
    panTo,
    drawRadius,
    plotMarkers,
    clearMarkers,
    plotStreetOverlay,
    clearStreetOverlay,
    openDirections,
    isReady,
    usesMapbox,
  };

})();
