/* ═══════════════════════════════════════════════════════
   ui.js — DOM rendering & UI interactions
   Shows only verifiable OpenStreetMap data (no simulated occupancy).
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
    const withCap = lots.reduce((sum, l) => sum + (Number.isFinite(l.availableSpots) ? Math.max(0, l.availableSpots) : 0), 0);
    document.getElementById('hdr-lots').textContent   = total.toLocaleString();
    document.getElementById('hdr-cap-tagged').textContent = withCap.toLocaleString();
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
        Search for a US place — we show <strong>mapped</strong> parking from OpenStreetMap.<br>
        <span style="font-size:0.62rem;color:var(--muted)">Live bay-by-bay occupancy is not included unless you add your own data API.</span>
      </div>`;
    document.getElementById('result-count').textContent = '0';
    updateHeaderStats([]);
  }

  function renderLotList(lots, activeLotId, onSelect) {
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
      const availLine = Number.isFinite(lot.availableSpots)
        ? `🟢 ${lot.availabilitySource === 'estimated' ? '~' : ''}${lot.availableSpots} spots available <span class="lc-tag-src">(${lot.availabilitySource})</span>`
        : `🟡 Availability <span class="lc-tag-src">unknown</span>`;
      const nameSafe   = Utils.escapeHtml(lot.name);

      return `
        <div class="lot-card ${isActive ? 'active' : ''}" data-lot-id="${lot.id}">
          <div class="lc-top">
            <div class="lc-name">${typeIco} ${nameSafe}</div>
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
          <div class="avail-bar" title="Colour reflects fee tag in OSM, not live occupancy">
            <div class="avail-fill" style="width:${barPct * 100}%;background:${fillColor}"></div>
          </div>
        </div>`;
    }).join('');

    const listEl = document.getElementById('lot-list');
    listEl.innerHTML = html;

    listEl.querySelectorAll('.lot-card').forEach(card => {
      card.addEventListener('click', () => onSelect(Number(card.dataset.lotId)));
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
   * @param {Object} lot
   * @param {Object} callbacks { onDirections, onOsm, onClose }
   */
  function openPanel(lot, callbacks) {
    document.getElementById('mp-title').textContent = lot.name;
    document.getElementById('mp-sub').textContent =
      `${lot.parkingType.replace(/-/g, ' ')} · OpenStreetMap · ${lot.osmType}/${lot.osmRef}`;

    document.getElementById('mp-capacity').textContent =
      Number.isFinite(lot.availableSpots)
        ? `${lot.availabilitySource === 'estimated' ? '~' : ''}${lot.availableSpots}`
        : '—';
    document.getElementById('mp-fee').textContent       = Utils.feeLabel(lot.fee);
    document.getElementById('mp-type').textContent =
      lot.parkingType === 'multi-storey' ? '🏢 Multi'  :
      lot.parkingType === 'underground'  ? '⬇ Under'   : '🅿 Surface';
    const disclaimer = document.getElementById('mp-disclaimer');
    disclaimer.innerHTML = lot.availabilitySource === 'live'
      ? 'Availability comes from your connected occupancy API. Confirm on site before parking.'
      : 'Availability is an estimate (based on capacity/fee) because no live occupancy API is connected.';

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

    document.getElementById('map-panel').classList.add('open');
  }

  function closePanel() {
    document.getElementById('map-panel').classList.remove('open');
  }

  function updateRadiusLabel(metres) {
    document.getElementById('radius-label').textContent = Utils.formatRadius(metres);
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
  };

})();
