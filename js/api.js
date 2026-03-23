/* ═══════════════════════════════════════════════════════
   api.js — All external API calls
   • Geocoding  : Mapbox Geocoding API  OR  Nominatim (OSM)
   • Parking    : OpenStreetMap Overpass API (real mapped features only)
═══════════════════════════════════════════════════════ */

'use strict';

const API = (() => {

  /* ────────────────────────────────────────────
     GEOCODING
  ──────────────────────────────────────────── */

  /**
   * Geocode a free-text address string into { lat, lng, label }.
   */
  async function geocode(query, mapboxToken) {
    const q = /usa|united states/i.test(query) ? query : `${query}, USA`;

    if (mapboxToken) {
      try {
        return await _geocodeMapbox(q, mapboxToken);
      } catch (_) {
        // Fall back to Nominatim when Mapbox is temporarily unavailable.
      }
    }
    return _geocodeNominatim(q);
  }

  async function _geocodeMapbox(q, token) {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
              + `?access_token=${encodeURIComponent(token)}&autocomplete=true&limit=1&country=us`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].center;
      return {
        lat,
        lng,
        label: data.features[0].place_name,
      };
    }
    return null;
  }

  async function _geocodeNominatim(q) {
    const url = `${CONFIG.NOMINATIM_URL}`
              + `?q=${encodeURIComponent(q)}`
              + `&format=json&limit=1&countrycodes=us`;

    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();

    if (data.length > 0) {
      return {
        lat:   parseFloat(data[0].lat),
        lng:   parseFloat(data[0].lon),
        label: data[0].display_name,
      };
    }
    return null;
  }

  /* ────────────────────────────────────────────
     OVERPASS — Real parking lots
  ──────────────────────────────────────────── */

  async function fetchParking(lat, lng, radiusM) {
    const query = _buildOverpassQuery(lat, lng, radiusM);
    const urls = (Array.isArray(CONFIG.OVERPASS_FALLBACK_URLS) && CONFIG.OVERPASS_FALLBACK_URLS.length)
      ? CONFIG.OVERPASS_FALLBACK_URLS
      : [CONFIG.OVERPASS_URL];

    let lastError = null;
    for (const url of urls) {
      try {
        const data = await _fetchOverpass(url, query);
        return data.elements || [];
      } catch (err) {
        lastError = err;
      }
    }

    const reason = lastError?.message || 'Unknown network error';
    throw new Error(`Could not reach Overpass servers. ${reason}`);
  }

  async function _fetchOverpass(url, query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Timeout from ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function _buildOverpassQuery(lat, lng, radius) {
    const around = `(around:${radius},${lat},${lng})`;
    return `
      [out:json][timeout:${CONFIG.OVERPASS_TIMEOUT}];
      (
        node["amenity"="parking"]${around};
        way["amenity"="parking"]${around};
        node["parking"="surface"]${around};
        way["parking"="surface"]${around};
        node["parking"="multi-storey"]${around};
        way["parking"="multi-storey"]${around};
        node["parking"="underground"]${around};
        way["parking"="underground"]${around};
      );
      out center tags;
    `;
  }

  /* ────────────────────────────────────────────
     PARSE — OSM elements → lot objects (no fake slots)
  ──────────────────────────────────────────── */

  function parseLots(elements, searchLat, searchLng) {
    return elements
      .map((el, i) => _parseElement(el, i, searchLat, searchLng))
      .filter(Boolean);
  }

  function _parseElement(el, index, searchLat, searchLng) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) return null;

    const tags         = el.tags || {};
    const name         = tags.name || tags['name:en'] || Utils.inferName(tags, index);
    const parkingType  = tags.parking || tags.amenity || 'surface';

    const capStr       = tags.capacity != null ? String(tags.capacity).trim() : '';
    const capMatch     = capStr ? capStr.match(/\d+/) : null;
    const capParsed    = capMatch ? parseInt(capMatch[0], 10) : NaN;
    const capacityKnown = Number.isFinite(capParsed) && capParsed > 0;
    const capacity      = capacityKnown ? capParsed : null;

    const dist = Utils.haversine(searchLat, searchLng, lat, lng);

    const osmType = el.type || 'node';
    const osmRef  = el.id;

    return {
      id:            index,
      osmType,
      osmRef,
      osmUrl:        `https://www.openstreetmap.org/${osmType}/${osmRef}`,
      name,
      lat,
      lng,
      fee:           tags.fee,
      parkingType,
      capacity,
      capacityKnown,
      access:        tags.access        || '',
      operator:      tags.operator      || '',
      openingHours:  tags.opening_hours || '',
      website:       tags.website       || tags.url || '',
      phone:         tags.phone         || tags['contact:phone'] || '',
      surface:       tags.surface       || '',
      lit:           tags.lit           || '',
      covered:       tags.covered       || '',
      maxstay:       tags.maxstay       || '',
      disabledSpaces: parseInt(tags['capacity:disabled'], 10) || 0,
      dist,
      tags,
    };
  }

  async function enrichAvailability(lots) {
    if (!Array.isArray(lots) || lots.length === 0) return lots;

    if (CONFIG.OCCUPANCY_API_URL) {
      try {
        const live = await _fetchLiveAvailability(lots);
        lots.forEach(lot => {
          const key = `${lot.osmType}/${lot.osmRef}`;
          const entry = live[key];
          if (entry && Number.isFinite(entry.available)) {
            lot.availableSpots = Math.max(0, Math.floor(entry.available));
            lot.availabilitySource = 'live';
            return;
          }
          _applyEstimatedAvailability(lot);
        });
        return lots;
      } catch (_) {
        // Gracefully fall back to local estimate when live feed fails.
      }
    }

    lots.forEach(_applyEstimatedAvailability);
    return lots;
  }

  async function _fetchLiveAvailability(lots) {
    const payload = {
      lots: lots.map(lot => ({
        id: `${lot.osmType}/${lot.osmRef}`,
        lat: lot.lat,
        lng: lot.lng,
        capacity: lot.capacity,
      })),
    };

    const res = await fetch(CONFIG.OCCUPANCY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Occupancy API ${res.status}`);
    const data = await res.json();
    return data && typeof data === 'object' ? data : {};
  }

  function _applyEstimatedAvailability(lot) {
    if (!lot.capacityKnown) {
      lot.availableSpots = null;
      lot.availabilitySource = 'unknown';
      return;
    }

    const baseRate = lot.fee === 'no' ? 0.32 : lot.fee === 'yes' ? 0.18 : 0.22;
    const hour = new Date().getHours();
    const peakPenalty = (hour >= 8 && hour <= 10) || (hour >= 16 && hour <= 19) ? 0.08 : 0;
    const rate = Math.max(0.05, baseRate - peakPenalty);

    lot.availableSpots = Math.max(0, Math.round(lot.capacity * rate));
    lot.availabilitySource = 'estimated';
  }

  return { geocode, fetchParking, parseLots, enrichAvailability };

})();
