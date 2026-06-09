// ── CONFIG ──
// API_BASE is set by frontend/config.js (loaded before this script).
// Falls back to localhost for safety if config.js is missing.
const API = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || 'http://localhost:8000';
const SLOTS_URL = `${API}/api/slots`;
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
  // if (id === 'screen-tram') renderTramSchedule();
  if (id === 'screen-parked') renderParkedScreen();
  // Sync checkout button state every time the scan-out screen is opened
  if (id === 'screen-scanout') syncCheckoutBtn();
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

function saveStoredActiveBooking({ booking_id, slot_id, slot_code, qr_token, expires_at, license_plate }) {
  localStorage.setItem(
    ACTIVE_BOOKING_KEY,
    JSON.stringify({ booking_id, slot_id, slot_code, qr_token, expires_at, license_plate })
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
    licensePlate: booking.license_plate,
  };
  state.parkedSlot = booking.slot_code;

  showBookingTicketModal({
    booking_id: booking.booking_id,
    slot_code: booking.slot_code,
    qr_token: booking.qr_token,
    expires_at: booking.expires_at,
    license_plate: booking.license_plate,
  });
}

// ── BOOKING TICKET MODAL ──
function showBookingTicketModal({ booking_id, slot_code, qr_token, expires_at, license_plate }) {
  const modal = document.getElementById('ticket-modal');
  const expiresAt = new Date(expires_at);

  document.getElementById('ticket-slot-code').textContent = slot_code;
  document.getElementById('ticket-booking-id').textContent = booking_id;
  new QRious({
    element: document.getElementById('ticket-qr-image'),
    value: qr_token,
    size: 150
  });
  document.getElementById('ticket-qr-image').alt = `QR Code for slot ${slot_code}`;

  // Show / hide license plate detail row
  const plateRow = document.getElementById('ticket-plate-row');
  const plateEl = document.getElementById('ticket-plate');
  if (plateRow && plateEl) {
    if (license_plate) {
      plateEl.textContent = license_plate;
      plateRow.hidden = false;
    } else {
      plateRow.hidden = true;
    }
  }

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

  const headers = {};
  const userToken = localStorage.getItem('userToken');
  if (userToken) {
    headers['Authorization'] = `Bearer ${userToken}`;
  }

  try {
    const res = await fetch(`${API}/api/slots/${slotId}/hold?qr_token=${encodeURIComponent(booking.qr_token)}`, {
      method: 'DELETE',
      headers: headers
    });
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

// ── LICENSE PLATE MODAL ──
let _pendingHoldSlotId = null;
let _pendingHoldSlotCode = null;

async function openPlateModal(slotId, slotCode) {
  _pendingHoldSlotId = slotId;
  _pendingHoldSlotCode = slotCode;

  const modal = document.getElementById('plate-modal');
  const lettersInp = document.getElementById('plate-letters');
  const numberInp = document.getElementById('plate-number');
  const provinceInp = document.getElementById('plate-province');
  const phoneInp = document.getElementById('plate-phone');
  const otpInp = document.getElementById('plate-otp');
  const hint = document.getElementById('plate-input-hint');
  const otpHint = document.getElementById('otp-input-hint');
  const confirm = document.getElementById('plate-confirm-btn');
  const requestOtpBtn = document.getElementById('plate-otp-request-btn');
  const verifyOtpBtn = document.getElementById('plate-otp-verify-btn');
  const savedVehiclesSelect = document.getElementById('plate-saved-vehicles');

  // Reset state
  lettersInp.value = '';
  numberInp.value = '';
  provinceInp.value = '';
  phoneInp.value = '';
  otpInp.value = '';
  hint.textContent = '';
  hint.className = 'plate-input-hint';
  otpHint.textContent = '';
  confirm.disabled = true;
  requestOtpBtn.disabled = true;
  verifyOtpBtn.disabled = true;

  // Hide otp input block
  document.getElementById('otp-input-wrap').style.display = 'none';

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');

  // Check if authenticated
  const userToken = localStorage.getItem('userToken');
  if (userToken) {
    try {
      // Fetch saved vehicles
      const res = await fetch(`${API}/api/users/vehicles`, {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      if (res.status === 401) {
        throw new Error('Unauthorized');
      }
      const vehicles = await res.json();
      
      // Populate select
      savedVehiclesSelect.innerHTML = '<option value="new">+ ระบุทะเบียนรถใหม่ (Enter new plate)</option>';
      vehicles.forEach(v => {
        const option = document.createElement('option');
        option.value = `${v.license_plate}|${v.province}`;
        option.textContent = `${v.license_plate} (${v.province})`;
        savedVehiclesSelect.appendChild(option);
      });

      // Show saved vehicles selection
      document.getElementById('saved-vehicles-wrap').style.display = 'block';
      // Hide phone entry since we are logged in
      document.getElementById('phone-input-wrap').style.display = 'none';
      
      // Select the first saved vehicle if it exists
      if (vehicles.length > 0) {
        savedVehiclesSelect.value = `${vehicles[0].license_plate}|${vehicles[0].province}`;
      } else {
        savedVehiclesSelect.value = 'new';
      }
    } catch (err) {
      console.warn('Failed to load saved vehicles, falling back to login:', err);
      localStorage.removeItem('userToken');
      // Hide saved vehicles select
      document.getElementById('saved-vehicles-wrap').style.display = 'none';
      // Show phone entry
      document.getElementById('phone-input-wrap').style.display = 'block';
    }
  } else {
    // Hide saved vehicles select
    document.getElementById('saved-vehicles-wrap').style.display = 'none';
    // Show phone entry
    document.getElementById('phone-input-wrap').style.display = 'block';
  }

  // Initial visibility sync
  syncModalFieldsVisibility();
  
  // Focus the phone input or manual letters input
  setTimeout(() => {
    if (document.getElementById('phone-input-wrap').style.display !== 'none') {
      phoneInp.focus();
    } else if (document.getElementById('manual-plate-wrap').style.display !== 'none') {
      lettersInp.focus();
    }
  }, 80);
}

async function refreshModalAfterAuth() {
  const userToken = localStorage.getItem('userToken');
  if (!userToken) return;

  const savedVehiclesSelect = document.getElementById('plate-saved-vehicles');
  if (!savedVehiclesSelect) return;

  try {
    const res = await fetch(`${API}/api/users/vehicles`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    if (res.status === 401) {
      throw new Error('Unauthorized');
    }
    const vehicles = await res.json();
    
    savedVehiclesSelect.innerHTML = '<option value="new">+ ระบุทะเบียนรถใหม่ (Enter new plate)</option>';
    vehicles.forEach(v => {
      const option = document.createElement('option');
      option.value = `${v.license_plate}|${v.province}`;
      option.textContent = `${v.license_plate} (${v.province})`;
      savedVehiclesSelect.appendChild(option);
    });

    document.getElementById('saved-vehicles-wrap').style.display = 'block';
    document.getElementById('phone-input-wrap').style.display = 'none';
    
    if (vehicles.length > 0) {
      savedVehiclesSelect.value = `${vehicles[0].license_plate}|${vehicles[0].province}`;
    } else {
      savedVehiclesSelect.value = 'new';
    }
  } catch (err) {
    console.warn('Failed to load saved vehicles:', err);
    localStorage.removeItem('userToken');
    document.getElementById('saved-vehicles-wrap').style.display = 'none';
    document.getElementById('phone-input-wrap').style.display = 'block';
  }

  syncModalFieldsVisibility();
}

function syncModalFieldsVisibility() {
  const userToken = localStorage.getItem('userToken');
  const savedVehiclesSelect = document.getElementById('plate-saved-vehicles');
  const isNewVehicle = savedVehiclesSelect.value === 'new';

  if (userToken) {
    document.getElementById('phone-input-wrap').style.display = 'none';
    document.getElementById('otp-input-wrap').style.display = 'none';
    if (isNewVehicle) {
      document.getElementById('manual-plate-wrap').style.display = 'block';
    } else {
      document.getElementById('manual-plate-wrap').style.display = 'none';
    }
  } else {
    document.getElementById('saved-vehicles-wrap').style.display = 'none';
    document.getElementById('phone-input-wrap').style.display = 'block';
    document.getElementById('manual-plate-wrap').style.display = 'block';
  }
  
  validateModalInputs();
}

function validateModalInputs() {
  const confirm = document.getElementById('plate-confirm-btn');
  const userToken = localStorage.getItem('userToken');
  const savedVehiclesSelect = document.getElementById('plate-saved-vehicles');
  const hint = document.getElementById('plate-input-hint');

  if (!userToken) {
    confirm.disabled = true;
    hint.textContent = 'กรุณากรอกเบอร์โทรศัพท์และยืนยัน OTP ก่อนทำการจอง';
    hint.className = 'plate-input-hint error';
    return;
  }

  const isNewVehicle = savedVehiclesSelect.value === 'new';
  if (!isNewVehicle) {
    // Valid saved vehicle is selected
    confirm.disabled = false;
    hint.textContent = '';
    hint.className = 'plate-input-hint';
    return;
  }

  // Validate manual inputs
  const lettersInp = document.getElementById('plate-letters');
  const numberInp = document.getElementById('plate-number');
  const provinceInp = document.getElementById('plate-province');

  const lettersVal = lettersInp.value.trim();
  const numberVal = numberInp.value.trim();
  const provinceVal = provinceInp.value;

  const lettersOk = /^[1-9]?[ก-ฮ]+$/.test(lettersVal);
  const numberOk = /^\d+$/.test(numberVal);
  const provinceOk = provinceVal !== "";

  if (lettersVal.length === 0 && numberVal.length === 0 && provinceVal === "") {
    confirm.disabled = true;
    hint.textContent = '';
    hint.className = 'plate-input-hint';
    return;
  }

  if (!lettersOk && lettersVal.length > 0) {
    confirm.disabled = true;
    hint.textContent = 'หมวดอักษรต้องเป็นภาษาไทย (สามารถมีตัวเลขนำหน้าได้ เช่น 1กข)';
    hint.className = 'plate-input-hint error';
    return;
  }

  if (!numberOk && numberVal.length > 0) {
    confirm.disabled = true;
    hint.textContent = 'เลขทะเบียนต้องเป็นตัวเลขเท่านั้น';
    hint.className = 'plate-input-hint error';
    return;
  }

  if (lettersOk && numberOk && provinceOk) {
    const combined = `${lettersVal} ${numberVal} ${provinceVal}`;
    if (combined.length > 20) {
      confirm.disabled = true;
      hint.textContent = 'ทะเบียนรถรวมต้องไม่เกิน 20 ตัวอักษร';
      hint.className = 'plate-input-hint error';
    } else {
      confirm.disabled = false;
      hint.textContent = '';
      hint.className = 'plate-input-hint';
    }
  } else {
    confirm.disabled = true;
    hint.textContent = '';
    hint.className = 'plate-input-hint';
  }
}

function closePlateModal() {
  const modal = document.getElementById('plate-modal');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  _pendingHoldSlotId = null;
  _pendingHoldSlotCode = null;
}

function initPlateModal() {
  const lettersInp = document.getElementById('plate-letters');
  const numberInp = document.getElementById('plate-number');
  const provinceInp = document.getElementById('plate-province');
  const phoneInp = document.getElementById('plate-phone');
  const otpInp = document.getElementById('plate-otp');
  const requestOtpBtn = document.getElementById('plate-otp-request-btn');
  const verifyOtpBtn = document.getElementById('plate-otp-verify-btn');
  const savedVehiclesSelect = document.getElementById('plate-saved-vehicles');
  const otpHint = document.getElementById('otp-input-hint');
  const confirm = document.getElementById('plate-confirm-btn');

  // Monitor manual plate entry changes
  lettersInp.addEventListener('input', () => {
    lettersInp.value = lettersInp.value.replace(/[^0-9ก-ฮ]/g, '');
    const match = lettersInp.value.match(/^([1-9]?)([ก-ฮ]*)/);
    lettersInp.value = match ? match[0] : '';
    validateModalInputs();
  });

  numberInp.addEventListener('input', () => {
    numberInp.value = numberInp.value.replace(/[^0-9]/g, '');
    validateModalInputs();
  });

  provinceInp.addEventListener('change', () => {
    validateModalInputs();
  });

  // Saved vehicles selection change
  savedVehiclesSelect.addEventListener('change', () => {
    syncModalFieldsVisibility();
  });

  // Monitor phone input
  phoneInp.addEventListener('input', () => {
    phoneInp.value = phoneInp.value.replace(/[^0-9+]/g, '');
    const phoneVal = phoneInp.value.trim();
    requestOtpBtn.disabled = !(phoneVal.length >= 9 && phoneVal.length <= 15 && /^\+?\d+$/.test(phoneVal));
  });

  // Request OTP click
  requestOtpBtn.addEventListener('click', async () => {
    const phone = phoneInp.value.trim();
    showToast('กำลังส่ง OTP...');
    try {
      const res = await fetch(`${API}/api/auth/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) throw new Error('Failed to request OTP');
      const data = await res.json();
      
      showToast('ส่ง OTP เรียบร้อยแล้ว');
      document.getElementById('otp-input-wrap').style.display = 'block';
      otpInp.value = '';
      verifyOtpBtn.disabled = true;
      otpHint.textContent = '';
      
      // Auto-populate OTP for easier dev/testing if available
      if (data.debug_otp) {
        otpHint.textContent = `[Debug] OTP is: ${data.debug_otp}`;
        otpHint.style.color = '#00e5a0';
      }
      
      setTimeout(() => otpInp.focus(), 80);
    } catch (err) {
      console.error(err);
      showToast('❌ ส่ง OTP ไม่สำเร็จ');
    }
  });

  // Monitor OTP input
  otpInp.addEventListener('input', () => {
    otpInp.value = otpInp.value.replace(/[^0-9]/g, '');
    verifyOtpBtn.disabled = otpInp.value.length !== 4;
  });

  // Verify OTP click
  verifyOtpBtn.addEventListener('click', async () => {
    const phone = phoneInp.value.trim();
    const otp = otpInp.value.trim();
    showToast('กำลังยืนยัน...');
    try {
      const res = await fetch(`${API}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'OTP verification failed');
      }
      const data = await res.json();
      
      // Save token
      localStorage.setItem('userToken', data.token);
      showToast('✓ ยืนยันตัวตนสำเร็จ');

      // Refresh plate modal view without resetting fields
      await refreshModalAfterAuth();
    } catch (err) {
      console.error(err);
      showToast(`❌ ${err.message || 'ยืนยัน OTP ไม่สำเร็จ'}`);
    }
  });

  // Enter key submits if confirm is enabled
  [lettersInp, numberInp, otpInp, phoneInp].forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (inp === phoneInp && !requestOtpBtn.disabled) {
          requestOtpBtn.click();
        } else if (inp === otpInp && !verifyOtpBtn.disabled) {
          verifyOtpBtn.click();
        } else if (!confirm.disabled) {
          confirm.click();
        }
      }
    });
  });

  document.getElementById('plate-cancel-btn').addEventListener('click', closePlateModal);
  document.getElementById('plate-modal-overlay').addEventListener('click', closePlateModal);

  confirm.addEventListener('click', async () => {
    const isNewVehicle = savedVehiclesSelect.value === 'new';
    let licensePlate = '';
    let province = '';

    const userToken = localStorage.getItem('userToken');
    if (userToken && !isNewVehicle) {
      const [plateVal, provVal] = savedVehiclesSelect.value.split('|');
      licensePlate = plateVal;
      province = provVal;
    } else {
      const lettersVal = lettersInp.value.trim();
      const numberVal = numberInp.value.trim();
      province = provinceInp.value;
      if (!lettersVal || !numberVal || !province) return;
      licensePlate = `${lettersVal} ${numberVal}`;
    }

    const slotId = _pendingHoldSlotId;
    const slotCode = _pendingHoldSlotCode;

    closePlateModal();
    await holdSlot(slotId, slotCode, licensePlate, province);
  });
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
      // Open plate verification modal instead of booking immediately
      openPlateModal(slotId, slotCode);
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
async function holdSlot(slotId, slotCode, licensePlate, province) {
  if (hasActiveStoredBooking()) {
    alert('คุณมีการจองที่กำลังใช้งานอยู่แล้ว (You already have an active booking)');
    return;
  }

  showToast(`กำลังจอง ${slotCode}...`);

  const headers = { 'Content-Type': 'application/json' };
  const userToken = localStorage.getItem('userToken');
  if (userToken) {
    headers['Authorization'] = `Bearer ${userToken}`;
  }

  try {
    const res = await fetch(`${API}/api/slots/${slotId}/hold`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ license_plate: licensePlate, province: province }),
    });

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
      license_plate: licensePlate,
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
      license_plate: licensePlate,
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
      id="hold-qr-image"
      alt="Booking QR Code"
      width="150"
      height="150"
      style="border-radius:4px;"
    />
  `;
  new QRious({
    element: document.getElementById('hold-qr-image'),
    value: token,
    size: 150
  });
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
      `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
    const qrToken = state.activeBooking.qrToken;
    await fetch(`${API}/api/slots/${state.activeBooking.slotId}/hold?qr_token=${encodeURIComponent(qrToken)}`, { method: 'DELETE' });
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
  const tramEl = document.getElementById('tram-next-time');
  if (tramEl) {
    const mins = Math.floor(Math.random() * 10) + 3;
    tramEl.textContent = `${mins} นาที`;
  }
  syncCheckoutBtn();
}

// ── SYNC CHECKOUT BUTTON (enable only when a valid booking + qr_token exists) ──
function syncCheckoutBtn() {
  const btn = document.getElementById('confirm-checkout-btn');
  if (!btn) return;

  const booking = getStoredActiveBooking();
  const hasBooking = !!booking && !!booking.qr_token;

  btn.disabled = !hasBooking;
  btn.classList.toggle('btn-disabled', !hasBooking);
  btn.title = hasBooking
    ? ''
    : 'ไม่มีการจองที่ใช้งานอยู่';
}

// ── CHECK OUT ──
async function checkOut() {
  // ── Guard: reject immediately if no active booking or missing token ──
  const booking = getStoredActiveBooking();
  if (!booking || !booking.qr_token) {
    showToast('⚠️ ไม่มีการจองที่ใช้งาน');
    syncCheckoutBtn(); // keep button in correct disabled state
    return;
  }

  const slotId = booking.slot_id;
  const qrToken = booking.qr_token;

  try {
    const res = await fetch(`${API}/api/slots/${slotId}/hold?qr_token=${encodeURIComponent(qrToken)}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const detail = errData.detail || 'ไม่สามารถออกจากลานจอดได้';
      alert(`⚠️ ${detail}\n\nหากคุณนำรถเข้าจอดแล้ว กรุณาสแกนคิวอาร์โค้ดที่เครื่องทางออกเพื่อยืนยันการออกจากช่องจอด`);
      return;
    }
  } catch (err) {
    console.error(err);
    showToast('🔌 เชื่อมต่อ Server ไม่สำเร็จ');
    return;
  }

  clearInterval(state.countdownTimer);
  hideBookingTicketModal();
  clearStoredActiveBooking();
  document.getElementById('checkout-result').textContent = '✓ คืนช่องจอดเรียบร้อย';
  state.activeBooking = null;
  state.parkedSlot = null;
  showToast('✓ ออกจากลานจอดเรียบร้อย');
  syncCheckoutBtn(); // disable the button now that booking is cleared
  setTimeout(async () => {
    document.getElementById('checkout-result').textContent = '';
    showScreen('screen-home');
    await loadSlots();
  }, 1800);
}

// ── TRAM SCHEDULE (Phase 8 — fetches mock from /api/trams/live) ──
async function renderTramSchedule() {
  // Tram features are temporarily disabled
  return;
  /*
  const pillText = document.getElementById('tram-live-pill-text');

  try {
    const res = await fetch(`${API}/api/trams/live`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const trams = data.trams ?? [];

    if (trams.length > 0 && pillText) {
      // Update the live pill with the first (soonest) tram
      const first = trams[0];
      pillText.textContent =
        `รถรางคันต่อไป: ${first.line} (${first.next_arrival}) — ${first.status}`;
    }

  } catch (err) {
    // Fail silently — static pill text is already in the HTML
    console.warn('[Tram] Could not fetch live data, showing static placeholder.', err);
  }
  */
}


// ── INIT ──
initPlateModal();
initTicketModal();
initParkingLotClicks();
loadSlots();
setInterval(loadSlots, 30000);
