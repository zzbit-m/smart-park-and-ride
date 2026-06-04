// ── CONFIG ──
const API = 'http://localhost:8000';
const SLOTS_URL = `${API}/api/slots`;
const QR_API = 'https://api.qrserver.com/v1/create-qr-code/';
const ACTIVE_BOOKING_KEY = 'activeBooking';

// ── STATE ──
let state = {
  slots: [],
  activeBooking: null,
  countdownTimer: null,
  modalCountdownTimer: null,
  parkedSlot: null,
};

// ── SCREEN NAVIGATION ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'screen-tram') renderTramSchedule();
  if (id === 'screen-parked') renderParkedScreen();
}

// ── TOAST ──
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── LOCAL STORAGE: ONE ACTIVE BOOKING PER DEVICE ──
function getStoredActiveBooking() {
  const raw = localStorage.getItem(ACTIVE_BOOKING_KEY);
  if (!raw) return null;

  try {
    const booking = JSON.parse(raw);
    if (!booking.expires_at) {
      localStorage.removeItem(ACTIVE_BOOKING_KEY);
      return null;
    }

    if (new Date(booking.expires_at) <= new Date()) {
      localStorage.removeItem(ACTIVE_BOOKING_KEY);
      return null;
    }

    return booking;
  } catch {
    localStorage.removeItem(ACTIVE_BOOKING_KEY);
    return null;
  }
}

function saveStoredActiveBooking({ booking_id, slot_id, slot_code, qr_token, expires_at }) {
  localStorage.setItem(
    ACTIVE_BOOKING_KEY,
    JSON.stringify({ booking_id, slot_id, slot_code, qr_token, expires_at })
  );
}

function clearStoredActiveBooking() {
  localStorage.removeItem(ACTIVE_BOOKING_KEY);
}

function hasActiveStoredBooking() {
  return getStoredActiveBooking() !== null;
}

function isOwnHeldSlot(slotId, slotCode) {
  const booking = getStoredActiveBooking();
  if (!booking) return false;
  return (
    Number(booking.slot_id) === Number(slotId) ||
    booking.slot_code === slotCode
  );
}

function reopenTicketFromStorage() {
  const booking = getStoredActiveBooking();
  if (!booking) return;

  state.activeBooking = {
    bookingId: booking.booking_id,
    slotId: booking.slot_id,
    slotCode: booking.slot_code,
    expiresAt: new Date(booking.expires_at),
    qrToken: booking.qr_token,
  };
  state.parkedSlot = booking.slot_code;

  showBookingTicketModal({
    booking_id: booking.booking_id,
    slot_code: booking.slot_code,
    qr_token: booking.qr_token,
    expires_at: booking.expires_at,
  });
}

// ── BOOKING TICKET MODAL ──
function showBookingTicketModal({ booking_id, slot_code, qr_token, expires_at }) {
  const modal = document.getElementById('ticket-modal');
  const expiresAt = new Date(expires_at);

  document.getElementById('ticket-slot-code').textContent = slot_code;
  document.getElementById('ticket-booking-id').textContent = booking_id;
  document.getElementById('ticket-qr-image').src =
    `${QR_API}?size=150x150&data=${encodeURIComponent(qr_token)}`;
  document.getElementById('ticket-qr-image').alt = `QR Code for slot ${slot_code}`;

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');

  startModalCountdown(expiresAt);
}

function hideBookingTicketModal() {
  const modal = document.getElementById('ticket-modal');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');

  if (state.modalCountdownTimer) {
    clearInterval(state.modalCountdownTimer);
    state.modalCountdownTimer = null;
  }
}

function startModalCountdown(expiresAt) {
  const el = document.getElementById('ticket-expiry-countdown');

  if (state.modalCountdownTimer) clearInterval(state.modalCountdownTimer);

  function tick() {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      el.textContent = '00:00';
      clearInterval(state.modalCountdownTimer);
      state.modalCountdownTimer = null;
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  tick();
  state.modalCountdownTimer = setInterval(tick, 1000);
}

async function cancelBookingFromModal() {
  const raw = localStorage.getItem(ACTIVE_BOOKING_KEY);
  if (!raw) {
    alert('ยกเลิกการจองไม่สำเร็จ');
    return;
  }

  let booking;
  try {
    booking = JSON.parse(raw);
  } catch {
    alert('ยกเลิกการจองไม่สำเร็จ');
    return;
  }

  const slotId = booking.slot_id;
  if (!slotId) {
    alert('ยกเลิกการจองไม่สำเร็จ');
    return;
  }

  try {
    const res = await fetch(`${API}/api/slots/${slotId}/hold`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Cancel failed (${res.status})`);

    clearStoredActiveBooking();
    hideBookingTicketModal();
    clearInterval(state.countdownTimer);
    state.activeBooking = null;
    state.parkedSlot = null;

    alert('ยกเลิกการจองสำเร็จ');
    await loadSlots();
  } catch (err) {
    console.error(err);
    alert('ยกเลิกการจองไม่สำเร็จ');
  }
}

function initTicketModal() {
  document.getElementById('ticket-modal-close').addEventListener('click', hideBookingTicketModal);
  document.getElementById('ticket-modal-overlay').addEventListener('click', hideBookingTicketModal);
  document.getElementById('cancel-btn').addEventListener('click', cancelBookingFromModal);
}

// ── PARKING LOT CLICK (event delegation — survives re-renders) ──
function initParkingLotClicks() {
  const lot = document.getElementById('parking-lot');
  lot.addEventListener('click', (event) => {
    const slotEl = event.target.closest('.lot-slot');
    if (!slotEl) return;

    const slotId = Number(slotEl.dataset.slotId);
    const slotCode = slotEl.dataset.slotCode;
    if (!slotId || !slotCode) return;

    if (slotEl.classList.contains('available')) {
      holdSlot(slotId, slotCode);
      return;
    }

    if (slotEl.classList.contains('held') && isOwnHeldSlot(slotId, slotCode)) {
      reopenTicketFromStorage();
    }
  });
}

// ── API: FETCH SLOTS ──
async function fetchSlots() {
  const res = await fetch(SLOTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to load slots (${res.status})`);
  }
  return res.json();
}

function slotSortKey(slotCode) {
  const match = String(slotCode).match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return slotCode;
  return `${match[1]}${String(match[2]).padStart(4, '0')}`;
}

function sortSlots(slots) {
  return [...slots].sort((a, b) =>
    slotSortKey(a.slot_code).localeCompare(slotSortKey(b.slot_code))
  );
}

/** Left column A1–A10, right column B1–B10 (matches seeded API data). */
function partitionSlotsForGrid(slots) {
  const sorted = sortSlots(slots);
  const columnA = sorted.filter(s => /^A/i.test(s.slot_code));
  const columnB = sorted.filter(s => /^B/i.test(s.slot_code));

  if (columnA.length && columnB.length) {
    return { left: columnA, right: columnB };
  }

  return {
    left: sorted.slice(0, 10),
    right: sorted.slice(10, 20),
  };
}

function normalizeStatus(liveStatus) {
  const raw = liveStatus || 'available';
  if (raw.startsWith('held')) return 'held';
  if (raw.startsWith('occupied')) return 'occupied';
  return 'available';
}

// ── LOAD SLOTS ──
async function loadSlots() {
  try {
    state.slots = await fetchSlots();
    renderParkingLot();
    updateAvailableCount();
  } catch (err) {
    console.error(err);
    state.slots = [];
    renderParkingLot();
    updateAvailableCount();
    showToast('⚠️ โหลดข้อมูลช่องจอดไม่สำเร็จ');
  }
}

// ── UPDATE COUNT ──
function updateAvailableCount() {
  const n = state.slots.filter(s => normalizeStatus(s.live_status) === 'available').length;
  document.getElementById('available-count').textContent = `${n} ว่าง`;
}

// ── RENDER PARKING LOT (2 cols × 10 rows with center lane) ──
function renderParkingLot() {
  const lot = document.getElementById('parking-lot');
  lot.replaceChildren();

  const { left, right } = partitionSlotsForGrid(state.slots);

  const entryTop = document.createElement('div');
  entryTop.className = 'lot-entry';
  entryTop.innerHTML = '<span class="entry-arrow">▼ ทางเข้า</span>';
  lot.appendChild(entryTop);

  const grid = document.createElement('div');
  grid.className = 'lot-grid';

  const rowCount = Math.max(left.length, right.length, 10);

  for (let row = 0; row < rowCount; row++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'lot-row';

    if (left[row]) rowEl.appendChild(makeSlotEl(left[row]));

    const lane = document.createElement('div');
    lane.className = 'lot-lane';
    lane.innerHTML = row === 4 ? '<span class="lane-arrow">↕</span>' : '';
    rowEl.appendChild(lane);

    if (right[row]) rowEl.appendChild(makeSlotEl(right[row]));

    grid.appendChild(rowEl);
  }

  lot.appendChild(grid);

  const entryBottom = document.createElement('div');
  entryBottom.className = 'lot-entry';
  entryBottom.innerHTML = '<span class="entry-arrow">▲ ทางออก</span>';
  lot.appendChild(entryBottom);
}

function makeSlotEl(slot) {
  const status = normalizeStatus(slot.live_status);
  const isOwnHold = status === 'held' && isOwnHeldSlot(slot.id, slot.slot_code);

  const el = document.createElement('div');
  el.className = `lot-slot ${status}`;
  el.dataset.slotId = String(slot.id);
  el.dataset.slotCode = slot.slot_code;

  if (status === 'available' || isOwnHold) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
  }

  if (isOwnHold) {
    el.style.cursor = 'pointer';
    el.title = 'แตะเพื่อดูตั๋วจอง / ยกเลิก';
  }

  el.innerHTML = `
    <div class="lot-slot-inner">
      <span class="lot-slot-icon">${status === 'available' ? '🅿' : status === 'held' ? '⏳' : '🚗'}</span>
      <span class="lot-slot-code">${slot.slot_code}</span>
    </div>
  `;

  return el;
}

// ── HOLD A SLOT ──
async function holdSlot(slotId, slotCode) {
  if (hasActiveStoredBooking()) {
    alert('คุณมีการจองที่กำลังใช้งานอยู่แล้ว (You already have an active booking)');
    return;
  }

  showToast(`กำลังจอง ${slotCode}...`);

  try {
    const res = await fetch(`${API}/api/slots/${slotId}/hold`, { method: 'POST' });

    if (res.status === 400 || res.status === 409) {
      showToast('❌ ช่องนี้ถูกจองแล้ว');
      await loadSlots();
      return;
    }

    if (!res.ok) throw new Error(`Hold failed (${res.status})`);

    const data = await res.json();

    saveStoredActiveBooking({
      booking_id: data.booking_id,
      slot_id: data.slot_id,
      slot_code: data.slot_code,
      qr_token: data.qr_token,
      expires_at: data.expires_at,
    });

    state.activeBooking = {
      bookingId: data.booking_id,
      slotId: data.slot_id,
      slotCode: data.slot_code,
      expiresAt: new Date(data.expires_at),
      qrToken: data.qr_token,
    };
    state.parkedSlot = data.slot_code;

    await loadSlots();

    showBookingTicketModal({
      booking_id: data.booking_id,
      slot_code: data.slot_code,
      qr_token: data.qr_token,
      expires_at: data.expires_at,
    });

    showToast('✓ จองสำเร็จ');
  } catch (err) {
    console.error(err);
    showToast('❌ เกิดข้อผิดพลาด');
    await loadSlots();
  }
}

// ── RENDER HOLD SCREEN ──
function renderHoldScreen() {
  const b = state.activeBooking;
  document.getElementById('hold-slot-code').textContent = b.slotCode;
  document.getElementById('qr-token-text').textContent = b.qrToken;
  renderQR(b.qrToken);
  startCountdown(b.expiresAt);
}

// ── QR CODE (hold screen placeholder) ──
function renderQR(token) {
  const box = document.getElementById('qr-box');
  box.innerHTML = `
    <img
      src="${QR_API}?size=150x150&data=${encodeURIComponent(token)}"
      alt="Booking QR Code"
      width="150"
      height="150"
      style="border-radius:4px;"
    />
  `;
}

// ── COUNTDOWN ──
function startCountdown(expiresAt) {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  const totalMs = expiresAt - Date.now();
  function tick() {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      clearInterval(state.countdownTimer);
      document.getElementById('countdown').textContent = '00:00';
      document.getElementById('countdown-bar').style.width = '0%';
      showToast('⏰ หมดเวลาจอง');
      clearStoredActiveBooking();
      loadSlots();
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    document.getElementById('countdown').textContent =
      `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    const pct = (remaining / totalMs) * 100;
    const bar = document.getElementById('countdown-bar');
    bar.style.width = `${pct}%`;
    bar.style.background = pct > 50
      ? 'linear-gradient(90deg,#00e5a0,#f5c542)'
      : pct > 20 ? 'linear-gradient(90deg,#f5c542,#ff9900)' : '#ff4d6d';
  }
  tick();
  state.countdownTimer = setInterval(tick, 1000);
}

// ── CANCEL HOLD ──
async function cancelHold() {
  if (!state.activeBooking) return;
  try {
    await fetch(`${API}/api/slots/${state.activeBooking.slotId}/hold`, { method: 'DELETE' });
  } catch (err) {
    console.error(err);
  }
  clearInterval(state.countdownTimer);
  hideBookingTicketModal();
  clearStoredActiveBooking();
  state.activeBooking = null;
  showToast('ยกเลิกการจองแล้ว');
  showScreen('screen-home');
  await loadSlots();
}

// ── PARKED SCREEN ──
function renderParkedScreen() {
  const slot = state.parkedSlot || '—';
  document.getElementById('parked-slot-display').textContent = slot;
  document.getElementById('scanout-slot-display').textContent = slot;
  const mins = Math.floor(Math.random() * 10) + 3;
  document.getElementById('tram-next-time').textContent = `${mins} นาที`;
}

// ── CHECK OUT ──
async function checkOut() {
  if (state.activeBooking) {
    try {
      await fetch(`${API}/api/slots/${state.activeBooking.slotId}/hold`, { method: 'DELETE' });
    } catch (err) {
      console.error(err);
    }
  }
  clearInterval(state.countdownTimer);
  hideBookingTicketModal();
  clearStoredActiveBooking();
  document.getElementById('checkout-result').textContent = '✓ คืนช่องจอดเรียบร้อย';
  state.activeBooking = null;
  state.parkedSlot = null;
  showToast('✓ ออกจากลานจอดเรียบร้อย');
  setTimeout(async () => {
    document.getElementById('checkout-result').textContent = '';
    showScreen('screen-home');
    await loadSlots();
  }, 1800);
}

// ── TRAM SCHEDULE ──
function renderTramSchedule() {
  const now = new Date();
  const schedule = [
    { route: 'สาย 1 → สถานีกลาง', zone: 'ZONE-A', offsetMin: 3 },
    { route: 'สาย 2 → ท่ารถ',     zone: 'ZONE-B', offsetMin: 8 },
    { route: 'สาย 1 → สถานีกลาง', zone: 'ZONE-A', offsetMin: 18 },
    { route: 'สาย 3 → อาคาร C',   zone: 'ZONE-C', offsetMin: 25 },
    { route: 'สาย 2 → ท่ารถ',     zone: 'ZONE-B', offsetMin: 33 },
  ];
  const list = document.getElementById('tram-list');
  list.innerHTML = '';
  schedule.forEach(item => {
    const dep = new Date(now.getTime() + item.offsetMin * 60000);
    const hh  = String(dep.getHours()).padStart(2,'0');
    const mm  = String(dep.getMinutes()).padStart(2,'0');
    const cls = item.offsetMin <= 5 ? 'soon' : item.offsetMin >= 30 ? 'late' : '';
    list.innerHTML += `
      <div class="tram-card ${cls}">
        <div class="tram-card-left">
          <div class="tram-card-route">${item.route}</div>
          <div class="tram-card-zone">${item.zone} · อีก ${item.offsetMin} นาที</div>
        </div>
        <div class="tram-card-time">${hh}:${mm}</div>
      </div>
    `;
  });
}

// ── INIT ──
initTicketModal();
initParkingLotClicks();
loadSlots();
setInterval(loadSlots, 30000);
