'use strict';

const SlotReservation = (() => {
  let _lot = null;
  let _selectedSlots = new Set();
  let _bookedSlots = {};
  let _toastTimer = null;

  const $ = id => document.getElementById(id);

  function init(lot) {
    _lot = lot;
    _selectedSlots = new Set();
    _renderGrid();
    _setReserveBtn(false);
    const card = $('booking-card');
    if (card) card.classList.remove('show');
  }

  function refresh() {
    if (!_lot) return;
    _renderGrid();
  }

  function _renderGrid() {
    const grid = $('slots-grid');
    if (!grid || !_lot || !Array.isArray(_lot.slots)) return;
    const booked = _bookedSlots[_lot.id] || [];

    grid.innerHTML = _lot.slots.map(slot => {
      const isBooked = booked.includes(slot.id) || slot.status === 'booked';
      const isSelected = _selectedSlots.has(slot.id);
      const cls = isBooked ? 'booked' : isSelected ? 'selected' : slot.status;
      const clickable = (slot.status === 'free' || isSelected) && !isBooked;
      const inner = isBooked ? '' : slot.status === 'taken' ? '🚗' : String(slot.id);
      return `<div class="ps-slot ${cls}" data-id="${slot.id}" ${clickable ? 'role="button" tabindex="0"' : ''}>${inner}</div>`;
    }).join('');

    grid.querySelectorAll('.ps-slot[role="button"]').forEach(el => {
      el.addEventListener('click', () => _onSlotClick(Number(el.dataset.id)));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _onSlotClick(Number(el.dataset.id));
        }
      });
    });
  }

  function _onSlotClick(slotId) {
    if (_selectedSlots.has(slotId)) _selectedSlots.delete(slotId);
    else _selectedSlots.add(slotId);
    _renderGrid();
    _setReserveBtn(_selectedSlots.size > 0);
  }

  function _autoPick() {
    if (!_lot) return;
    const booked = _bookedSlots[_lot.id] || [];
    const free = _lot.slots.filter(s => s.status === 'free' && !booked.includes(s.id));
    if (!free.length) {
      _toast('No Free Slots', 'All slots are currently occupied.', true);
      return;
    }
    _selectedSlots = new Set([free[Math.floor(free.length * 0.1)].id]);
    _renderGrid();
    _setReserveBtn(true);
  }

  function _openModal() {
    if (!_lot || _selectedSlots.size === 0) {
      _toast('No Slots Selected', 'Click one or more green slots, or use Auto-Pick first.', true);
      return;
    }
    const selectedList = Array.from(_selectedSlots).sort((a, b) => a - b);
    const slotLabel = selectedList.length === 1
      ? `Slot #${selectedList[0]}`
      : `${selectedList.length} slots`;
    $('ps-modal-sub').textContent = `${_lot.name} · ${slotLabel}`;
    $('ps-confirm-box').innerHTML = `
      <div class="ps-confirm-row"><span class="ps-confirm-label">Parking Lot</span><span class="ps-confirm-value">${_lot.name}</span></div>
      <div class="ps-confirm-row"><span class="ps-confirm-label">Slots</span><span class="ps-confirm-value">${selectedList.map(x => `#${x}`).join(', ')}</span></div>
      <div class="ps-confirm-row"><span class="ps-confirm-label">Type</span><span class="ps-confirm-value">${(_lot.parkingType || 'surface').toUpperCase()}</span></div>
      <div class="ps-confirm-row"><span class="ps-confirm-label">Fee</span><span class="ps-confirm-value">${_lot.fee === 'no' ? 'FREE' : _lot.fee === 'yes' ? 'PAID' : 'CHECK ON SITE'}</span></div>
    `;
    $('ps-plate').value = '';
    $('ps-name').value = '';
    $('ps-duration').value = '2';
    $('ps-plate').classList.remove('error');
    $('ps-modal-overlay').classList.add('open');
    setTimeout(() => $('ps-plate').focus(), 120);
  }

  function _closeModal() {
    $('ps-modal-overlay').classList.remove('open');
  }

  function _confirmBooking() {
    if (!_lot || _selectedSlots.size === 0) return;
    const plate = $('ps-plate').value.trim().toUpperCase();
    const name = $('ps-name').value.trim();
    const duration = parseInt($('ps-duration').value, 10) || 2;
    if (!plate) {
      $('ps-plate').classList.add('error');
      _toast('Plate Required', 'Please enter your vehicle plate number.', true);
      return;
    }

    const selectedList = Array.from(_selectedSlots).sort((a, b) => a - b);
    const nowUnavailable = selectedList.filter(id => {
      const slot = _lot.slots.find(s => s.id === id);
      return !slot || slot.status !== 'free';
    });
    if (nowUnavailable.length > 0) {
      _toast('Some Slots Taken', `These slots are no longer free: ${nowUnavailable.map(x => `#${x}`).join(', ')}`, true);
      nowUnavailable.forEach(id => _selectedSlots.delete(id));
      _renderGrid();
      _setReserveBtn(_selectedSlots.size > 0);
      if (_selectedSlots.size === 0) _closeModal();
      return;
    }

    if (!_bookedSlots[_lot.id]) _bookedSlots[_lot.id] = [];
    selectedList.forEach(id => {
      const slot = _lot.slots.find(s => s.id === id);
      if (slot) slot.status = 'booked';
      _bookedSlots[_lot.id].push(id);
    });

    const ref = _genRef();
    const slotIds = selectedList.slice();
    _selectedSlots = new Set();
    _closeModal();
    _renderGrid();
    _setReserveBtn(false);
    _showBookingCard({ slotIds, plate, name, duration, ref });
    _toast(
      'Booking Confirmed',
      `${slotIds.length} slot${slotIds.length > 1 ? 's' : ''} · ${plate} · Ref: ${ref}`,
      false
    );

    slotIds.forEach(slotId => {
      document.dispatchEvent(new CustomEvent('ps:booked', {
        detail: { lotId: _lot.id, slotId, plate, name, duration, ref },
      }));
    });
  }

  function _showBookingCard({ slotIds, plate, name, duration, ref }) {
    const card = $('booking-card');
    const refEl = $('booking-ref');
    if (!card || !refEl) return;
    const slotLabel = slotIds.length === 1
      ? `#${slotIds[0]}`
      : slotIds.map(id => `#${id}`).join(', ');
    refEl.innerHTML = `
      <span><b>Booking Ref</b> ${ref}</span>
      <span><b>Slot${slotIds.length > 1 ? 's' : ''}</b> ${slotLabel}</span>
      <span><b>Plate</b> ${plate}</span>
      ${name ? `<span><b>Name</b> ${name}</span>` : ''}
      <span><b>Duration</b> ${duration}h</span>`;
    card.classList.add('show');
  }

  function _setReserveBtn(enabled) {
    const btn = $('btn-reserve');
    if (!btn) return;
    btn.disabled = !enabled;
    if (!enabled) {
      btn.textContent = 'Reserve Slot →';
      return;
    }
    const count = _selectedSlots.size;
    btn.textContent = count === 1
      ? `Reserve Slot #${Array.from(_selectedSlots)[0]} →`
      : `Reserve ${count} Slots →`;
  }

  function _toast(title, body, isError) {
    const el = $('ps-toast');
    if (!el) return;
    $('ps-toast-title').textContent = title;
    $('ps-toast-body').textContent = body;
    el.className = `ps-toast show${isError ? ' error' : ''}`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  function _genRef() {
    return 'PS-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Date.now().toString(36).toUpperCase().slice(-4);
  }

  function _setDurChip(hours) {
    document.querySelectorAll('.ps-dur-chip').forEach(c => {
      c.classList.toggle('on', Number(c.dataset.h) === hours);
    });
  }

  function _bindEvents() {
    $('btn-auto-pick')?.addEventListener('click', _autoPick);
    $('btn-reserve')?.addEventListener('click', _openModal);
    $('ps-modal-close')?.addEventListener('click', _closeModal);
    $('ps-cancel-btn')?.addEventListener('click', _closeModal);
    $('ps-confirm-btn')?.addEventListener('click', _confirmBooking);
    $('ps-plate')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _confirmBooking();
    });
    $('ps-modal-overlay')?.addEventListener('click', e => {
      if (e.target === $('ps-modal-overlay')) _closeModal();
    });
    $('ps-dur-chips')?.addEventListener('click', e => {
      const chip = e.target.closest('.ps-dur-chip');
      if (!chip) return;
      const h = Number(chip.dataset.h);
      $('ps-duration').value = String(h);
      _setDurChip(h);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bindEvents);
  } else {
    _bindEvents();
  }

  return { init, refresh };
})();
