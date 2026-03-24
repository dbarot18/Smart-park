/* ═══════════════════════════════════════════════════════
   ui.js — DOM rendering & UI interactions
   OSM tags + optional OCCUPANCY_API_URL for live free counts.
═══════════════════════════════════════════════════════ */

'use strict';

const UI = (() => {

  let _toastTimer = null;

  function toast(title, body, isError = false) {
    const el = document.getElementById('toast');
    document.getElementById('toast-t').textContent = title;
    document.getElementById('toast-b').textContent = body;
    el.className = `toast show${isError ? ' err' : ''}`;

    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  function updateHeaderStats(lots) {
    const total = lots.length;
    const withCapTag = lots.filter(l => l.capacityKnown).length;
    document.getElementById('hdr-lots').textContent   = total.toLocaleString();
    document.getElementById('hdr-cap-tagged').textContent = withCapTag.toLocaleString();
  }

  function showLoading() {
    document.getElementById('lot-list').innerHTML = `
      <div class="state-box">
        <div class="spinner"></div>
        Loading OpenStreetMap data…<br>
        <span style="font-size:0.6rem;color:var(--muted)">Overpass API · mapped features only</span>
      </div>`;
    document.getElementById('result-count').textContent = '…';
  }

  function showEmpty(message) {
    const msg = message || 'No parking mapped here.<br>Try a wider radius or another area.';
    document.getElementById('lot-list').innerHTML = `
      <div class="state-box">
        <span class="icon">🔍</span>${msg}
      </div>`;
    document.getElementById('result-count').textContent = '0';
    updateHeaderStats([]);
  }

  function showWelcome() {
    document.getElementById('lot-list').innerHTML = `
      <div class="state-box">
        <span class="icon">🗺️</span>
        Search for a US place or tap a quick city:<br>
        <span class="quick-cities">
          <button class="city-chip" data-city="New York">New York</button>
          <button class="city-chip" data-city="Chicago">Chicago</button>
          <button class="city-chip" data-city="Miami">Miami</button>
          <button class="city-chip" data-city="Los Angeles">Los Angeles</button>
          <button class="city-chip" data-city="Seattle">Seattle</button>
        </span>
      </div>`;
    document.getElementById('result-count').textContent = '0';
    updateHeaderStats([]);
  }

  function renderLotList(lots, activeLotId, onSelect, onToggleFavourite) {
    document.getElementById('result-count').textContent = lots.length;

    if (!lots.length) { showEmpty(); return; }

    const html = lots.slice(0, CONFIG.MAX_LIST_RESULTS).map(lot => {
      const badgeClass = lot.fee === 'no'  ? 'b-free' :
                         lot.fee === 'yes' ? 'b-paid' : 'b-unkn';
      const badgeText  = lot.fee === 'no'  ? '🆓 FREE (tag)' :
                         lot.fee === 'yes' ? '💳 PAID (tag)' : 'ℹ FEE ?';
      const fillColor  = Utils.lotMarkerColor(lot);
      const barPct     = lot.fee === 'no' ? 1 : lot.fee === 'yes' ? 0.55 : 0.3;
      const typeIco    = Utils.typeIcon(lot.parkingType);
      const distStr    = Utils.formatDist(lot.dist);
      const isActive   = lot.id === activeLotId;
      const availLine = lot.availabilitySource === 'live' && Number.isFinite(lot.availableSpots)
        ? `🟢 ${lot.availableSpots} free (live) <span class="lc-tag-src">(API)</span>`
        : lot.availabilitySource === 'demo' && Number.isFinite(lot.availableSpots)
          ? `🟢 ~${lot.availableSpots} free spots <span class="lc-tag-src">(demo)</span>`
          : `⚪ No estimate <span class="lc-tag-src">(run search)</span>`;
      const nameSafe   = Utils.escapeHtml(lot.name);
      const favClass = lot.isFavourite ? 'on' : '';

      return `
        <div class="lot-card ${isActive ? 'active' : ''}" data-lot-id="${lot.id}">
          <div class="lc-top">
            <div class="lc-title">
              <div class="lc-name">${typeIco} ${nameSafe}</div>
              <button class="fav-btn ${favClass}" data-fav-id="${lot.id}" title="Save favourite">★</button>
            </div>
            <div class="lc-badge ${badgeClass}">${badgeText}</div>
          </div>
          <div class="lc-addr">
            📍 ${lot.lat.toFixed(5)}, ${lot.lng.toFixed(5)}
          </div>
          <div class="lc-meta">
            <span>${availLine}</span>
            <span>📏 ${distStr}</span>
            ${lot.openingHours ? `<span>🕐 ${Utils.escapeHtml(lot.openingHours)}</span>` : ''}
            ${lot.disabledSpaces > 0 ? `<span>♿ ${lot.disabledSpaces}</span>` : ''}
          </div>
          <div class="avail-bar" title="Pin colour reflects live API counts when configured; otherwise neutral">
            <div class="avail-fill" style="width:${barPct * 100}%;background:${fillColor}"></div>
          </div>
        </div>`;
    }).join('');

    const listEl = document.getElementById('lot-list');
    listEl.innerHTML = html;

    listEl.querySelectorAll('.lot-card').forEach(card => {
      card.addEventListener('click', () => onSelect(Number(card.dataset.lotId)));
    });
    listEl.querySelectorAll('.fav-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        onToggleFavourite(Number(btn.dataset.favId));
      });
    });
  }

  function scrollToActiveCard() {
    const active = document.querySelector('.lot-card.active');
    active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function _detailRow(label, value) {
    if (value == null || String(value).trim() === '') return '';
    return `
      <div class="mp-row">
        <dt>${Utils.escapeHtml(label)}</dt>
        <dd>${Utils.escapeHtml(String(value))}</dd>
      </div>`;
  }

  function _detailLink(label, url, text) {
    if (!url) return '';
    const safe = Utils.escapeHtml(url);
    const t    = Utils.escapeHtml(text || url);
    return `
      <div class="mp-row">
        <dt>${Utils.escapeHtml(label)}</dt>
        <dd><a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a></dd>
      </div>`;
  }

  /**
   * Single renderer for #slots-grid — SlotReservation owns the grid (ps-slot cells).
   * Call SlotReservation.init(lot) before openPanel so refresh() has a lot context.
   */
  function _renderSlots(lot) {
    const slotsEl = document.getElementById('slots-grid');
    if (!slotsEl) return;
    if (!Array.isArray(lot.slots) || !lot.slots.length) {
      slotsEl.innerHTML = '<div class="state-box">No slot map available for this lot.</div>';
      return;
    }
    if (typeof SlotReservation !== 'undefined' && SlotReservation.refresh) {
      SlotReservation.refresh();
    }
  }

  function openPanel(lot, callbacks) {
    document.getElementById('mp-title').textContent = lot.name;
    document.getElementById('mp-sub').textContent =
      `${lot.parkingType.replace(/-/g, ' ')} · OpenStreetMap · ${lot.osmType}/${lot.osmRef}`;

    document.getElementById('mp-capacity').textContent =
      (lot.availabilitySource === 'live' || lot.availabilitySource === 'demo') && Number.isFinite(lot.availableSpots)
        ? String(lot.availableSpots)
        : '—';
    const capLab = document.getElementById('mp-capacity-label');
    if (capLab) {
      capLab.textContent = lot.availabilitySource === 'live'
        ? 'Free bays (live API)'
        : lot.availabilitySource === 'demo'
          ? 'Free bays (demo estimate)'
          : 'Free bays (not live — set API)';
    }
    document.getElementById('mp-fee').textContent       = Utils.feeLabel(lot.fee);
    document.getElementById('mp-type').textContent =
      lot.parkingType === 'multi-storey' ? '🏢 Multi'  :
      lot.parkingType === 'underground'  ? '⬇ Under'   : '🅿 Surface';
    const disclaimer = document.getElementById('mp-disclaimer');
    const capNote = lot.capacityKnown
      ? ` OpenStreetMap capacity tag: <strong>${lot.capacity}</strong> bays (grid capped at 60).`
      : ` Estimated <strong>${lot.capacity}</strong> bays for the demo grid (no capacity tag in OSM).`;
    if (lot.availabilitySource === 'live') {
      disclaimer.innerHTML = `Counts come from your <strong>OCCUPANCY_API_URL</strong> integration. Confirm on site before parking.${capNote}`;
    } else if (lot.availabilitySource === 'demo') {
      disclaimer.innerHTML = `Bay states are <strong>simulated</strong> for this demo — not live sensor data. Confirm on site.${capNote}`;
    } else {
      disclaimer.innerHTML = `Set <strong>CONFIG.OCCUPANCY_API_URL</strong> in <code>js/config.js</code> for live free counts, or use the demo estimate after search.${capNote}`;
    }

    const srcBadge = document.getElementById('slot-source-badge');
    const srcLabel = document.getElementById('slot-source-label');
    if (srcBadge && srcLabel) {
      srcBadge.classList.toggle('live-on', lot.availabilitySource === 'live' || lot.availabilitySource === 'demo');
      srcLabel.textContent = lot.availabilitySource === 'live'
        ? 'Live API'
        : lot.availabilitySource === 'demo'
          ? 'Demo slots'
          : 'OSM only';
    }

    const detailsEl = document.getElementById('mp-details');
    detailsEl.innerHTML = [
      _detailRow('Operator', lot.operator),
      _detailRow('Availability source', lot.availabilitySource || 'unknown'),
      _detailRow('Capacity (OSM tag)', lot.capacityKnown ? String(lot.capacity) : 'Not mapped'),
      _detailRow('Opening hours', lot.openingHours),
      _detailRow('Access', lot.access),
      _detailRow('Max stay', lot.maxstay),
      _detailRow('Surface', lot.surface),
      _detailRow('Lit', lot.lit),
      _detailRow('Covered', lot.covered),
      lot.disabledSpaces > 0 ? _detailRow('Disabled spaces (tag)', String(lot.disabledSpaces)) : '',
      _detailRow('Coordinates', `${lot.lat.toFixed(6)}, ${lot.lng.toFixed(6)}`),
      _detailLink('OpenStreetMap', lot.osmUrl, 'View feature'),
      _detailLink('Website', lot.website, 'Link'),
      _detailRow('Phone', lot.phone),
    ].join('');

    document.getElementById('dir-btn').onclick  = callbacks.onDirections;
    document.getElementById('osm-btn').onclick  = callbacks.onOsm;
    document.getElementById('mp-close').onclick = callbacks.onClose;
    _renderSlots(lot);

    document.getElementById('map-panel').classList.add('open');
  }

  function closePanel() {
    document.getElementById('map-panel').classList.remove('open');
  }

  function updateRadiusLabel(metres) {
    document.getElementById('radius-label').textContent = Utils.formatRadius(metres);
  }

  function updateCityStats(lots) {
    const total = lots.length;
    const hasNumbers = lots.some(l =>
      (l.availabilitySource === 'live' || l.availabilitySource === 'demo') && Number.isFinite(l.availableSpots));
    const free = lots.reduce((sum, lot) => sum + (Number.isFinite(lot.availableSpots) ? Math.max(0, lot.availableSpots) : 0), 0);
    const cap = lots.reduce((sum, lot) => sum + (Number.isFinite(lot.capacity) ? lot.capacity : 0), 0);
    const fillPct = cap > 0 && hasNumbers ? Math.round(((cap - free) / cap) * 100) : null;
    document.getElementById('ss-total').textContent = String(total);
    document.getElementById('ss-free').textContent = hasNumbers ? String(free) : '—';
    document.getElementById('ss-fill').textContent = fillPct != null ? `${Utils.clamp(fillPct, 0, 100)}%` : '—';
  }

  function renderRecentSearches(items, onPick) {
    const el = document.getElementById('recent-list');
    if (!el) return;
    if (!items || !items.length) {
      el.innerHTML = '<span style="font-family:var(--font-mono);font-size:0.58rem;color:var(--muted);">No recent searches yet</span>';
      return;
    }
    el.innerHTML = items.map(item => `<button class="recent-chip" data-recent="${Utils.escapeHtml(item)}">${Utils.escapeHtml(item)}</button>`).join('');
    el.querySelectorAll('.recent-chip').forEach(btn => {
      btn.addEventListener('click', () => onPick(btn.dataset.recent));
    });
  }

  function openReserveModal(lot, slot, onConfirm) {
    const modal = document.getElementById('reserve-modal');
    const plateInput = document.getElementById('plate-input');
    document.getElementById('reserve-sub').textContent = `${lot.name} · Slot ${slot.id}`;
    document.getElementById('reserve-summary').innerHTML = `
      <div class="cr"><span class="cl">Lot</span><span class="cv">${Utils.escapeHtml(lot.name)}</span></div>
      <div class="cr"><span class="cl">Slot</span><span class="cv">${slot.id}</span></div>
      <div class="cr"><span class="cl">Distance</span><span class="cv">${Utils.formatDist(lot.dist)}</span></div>`;
    plateInput.value = '';
    modal.classList.add('open');
    plateInput.focus();

    const close = () => modal.classList.remove('open');
    document.getElementById('reserve-cancel').onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };
    document.getElementById('reserve-confirm').onclick = () => {
      const plate = plateInput.value.trim().toUpperCase();
      if (!plate || plate.length < 3) {
        toast('Invalid plate', 'Enter a valid plate number (at least 3 characters).', true);
        return;
      }
      close();
      onConfirm({ plate });
    };
  }

  return {
    toast,
    updateHeaderStats,
    showLoading,
    showEmpty,
    showWelcome,
    renderLotList,
    scrollToActiveCard,
    openPanel,
    closePanel,
    updateRadiusLabel,
    updateCityStats,
    renderRecentSearches,
    openReserveModal,
  };

})();
