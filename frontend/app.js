// ── CONFIG ──
const API = 'http://localhost:8000';
const USE_DEMO = window.location.protocol === 'file:';

// ── STATE ──
let state = {
  slots: [],
  activeBooking: null,
  countdownTimer: null,
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

// ── DEMO DATA ──
function generateDemoSlots() {
  const statuses = [
    'available','occupied',
    'available','available',
    'held',     'occupied',
    'available','available',
    'occupied', 'available',
    'available','held',
    'available','occupied',
    'available','available',
    'held',     'available',
    'occupied', 'available',
  ];
  return statuses.map((s, i) => ({
    id: i + 1,
    slot_code: `A-${String(i + 1).padStart(2, '0')}`,
    zone_id: 1,
    live_status: s,
  }));
}

// ── LOAD SLOTS ──
async function loadSlots() {
  if (USE_DEMO) {
    state.slots = generateDemoSlots();
    renderParkingLot();
    updateAvailableCount();
    return;
  }
  try {
    const res = await fetch(`${API}/api/slots/`);
    if (!res.ok) throw new Error();
    state.slots = await res.json();
    renderParkingLot();
    updateAvailableCount();
  } catch {
    state.slots = generateDemoSlots();
    renderParkingLot();
    updateAvailableCount();
    showToast('⚠️ ใช้ข้อมูลตัวอย่าง');
  }
}

// ── UPDATE COUNT ──
function updateAvailableCount() {
  const n = state.slots.filter(s => {
    const st = s.live_status || 'available';
    return !st.startsWith('held') && !st.startsWith('occupied');
  }).length;
  document.getElementById('available-count').textContent = `${n} ว่าง`;
}

// ── RENDER PARKING LOT (2 cols × 10 rows with center lane) ──
function renderParkingLot() {
  const lot = document.getElementById('parking-lot');
  lot.innerHTML = '';

  // Split into left column (odd index) and right column (even index)
  // Layout: [slot][slot] ... lane ... [slot][slot]
  // We'll do 2 side-by-side blocks of 10, separated by a driving lane

  const left  = state.slots.slice(0, 10);   // A-01 to A-10
  const right = state.slots.slice(10, 20);  // A-11 to A-20

  // Header row: entry arrow
  lot.innerHTML = `
    <div class="lot-entry">
      <span class="entry-arrow">▼ ทางเข้า</span>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'lot-grid';

  for (let row = 0; row < 10; row++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'lot-row';

    // Left slot
    if (left[row]) rowEl.appendChild(makeSlotEl(left[row]));

    // Center lane
    const lane = document.createElement('div');
    lane.className = 'lot-lane';
    lane.innerHTML = row === 4 ? '<span class="lane-arrow">↕</span>' : '';
    rowEl.appendChild(lane);

    // Right slot
    if (right[row]) rowEl.appendChild(makeSlotEl(right[row]));

    grid.appendChild(rowEl);
  }

  lot.appendChild(grid);

  // Exit arrow
  lot.innerHTML += `<div class="lot-entry"><span class="entry-arrow">▲ ทางออก</span></div>`;
}

function makeSlotEl(slot) {
  const rawStatus = slot.live_status || 'available';
  const status = rawStatus.startsWith('held')     ? 'held'
               : rawStatus.startsWith('occupied') ? 'occupied'
               : 'available';

  const el = document.createElement('div');
  el.className = `lot-slot ${status}`;
  el.innerHTML = `
    <div class="lot-slot-inner">
      <span class="lot-slot-icon">${status === 'available' ? '🅿' : status === 'held' ? '⏳' : '🚗'}</span>
      <span class="lot-slot-code">${slot.slot_code}</span>
    </div>
  `;

  if (status === 'available') {
    el.onclick = () => holdSlot(slot.id, slot.slot_code);
  }

  return el;
}

// ── HOLD A SLOT ──
async function holdSlot(slotId, slotCode) {
  showToast(`กำลังจอง ${slotCode}...`);

  if (USE_DEMO) {
    state.activeBooking = {
      bookingId: 'demo-' + Date.now(),
      slotId,
      slotCode,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      qrToken: 'PR-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
    };
    state.parkedSlot = slotCode;
    state.slots = state.slots.map(s =>
      s.id === slotId ? { ...s, live_status: 'held' } : s
    );
    renderHoldScreen();
    showScreen('screen-hold');
    renderParkingLot();
    updateAvailableCount();
    return;
  }

  try {
    const res = await fetch(`${API}/api/slots/${slotId}/hold`, { method: 'POST' });
    if (res.status === 409) { showToast('❌ ช่องนี้ถูกจองแล้ว'); loadSlots(); return; }
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.activeBooking = {
      bookingId: data.booking_id,
      slotId: data.slot_id,
      slotCode: data.slot_code,
      expiresAt: new Date(data.expires_at),
      qrToken: data.qr_token,
    };
    state.parkedSlot = state.activeBooking.slotCode;
    renderHoldScreen();
    showScreen('screen-hold');
    loadSlots();
  } catch { showToast('❌ เกิดข้อผิดพลาด'); }
}

// ── RENDER HOLD SCREEN ──
function renderHoldScreen() {
  const b = state.activeBooking;
  document.getElementById('hold-slot-code').textContent = b.slotCode;
  document.getElementById('qr-token-text').textContent = b.qrToken;
  renderQR(b.qrToken);
  startCountdown(b.expiresAt);
}

// ── QR CODE ──
function renderQR(token) {
  const box = document.getElementById('qr-box');
  box.innerHTML = `
    <div style="width:176px;height:176px;background:#fff;display:flex;flex-direction:column;
                align-items:center;justify-content:center;gap:8px;padding:12px;">
      <div style="width:120px;height:120px;
                  background:repeating-conic-gradient(#000 0% 25%,#fff 0% 50%) 0 0/10px 10px;
                  border:3px solid #000;border-radius:4px;position:relative;">
        <div style="position:absolute;inset:30px;background:#fff;display:flex;
                    align-items:center;justify-content:center;font-size:10px;
                    font-weight:bold;color:#000;text-align:center;
                    border:2px solid #000;border-radius:2px;">P&R</div>
      </div>
      <div style="font-size:8px;color:#333;font-family:monospace;
                  word-break:break-all;text-align:center;">
        ${token.substring(0, 16)}
      </div>
    </div>
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
  if (!USE_DEMO) {
    try { await fetch(`${API}/api/slots/${state.activeBooking.slotId}/hold`, { method: 'DELETE' }); } catch {}
  }
  clearInterval(state.countdownTimer);
  state.activeBooking = null;
  showToast('ยกเลิกการจองแล้ว');
  showScreen('screen-home');
  loadSlots();
}

// ── PARKED SCREEN ──
function renderParkedScreen() {
  const slot = state.parkedSlot || 'A-01';
  document.getElementById('parked-slot-display').textContent = slot;
  document.getElementById('scanout-slot-display').textContent = slot;
  const mins = Math.floor(Math.random() * 10) + 3;
  document.getElementById('tram-next-time').textContent = `${mins} นาที`;
}

// ── CHECK OUT ──
async function checkOut() {
  if (!USE_DEMO && state.activeBooking) {
    try { await fetch(`${API}/api/slots/${state.activeBooking.slotId}/hold`, { method: 'DELETE' }); } catch {}
  }
  clearInterval(state.countdownTimer);
  document.getElementById('checkout-result').textContent = '✓ คืนช่องจอดเรียบร้อย';
  state.activeBooking = null;
  state.parkedSlot = null;
  showToast('✓ ออกจากลานจอดเรียบร้อย');
  setTimeout(() => {
    document.getElementById('checkout-result').textContent = '';
    showScreen('screen-home');
    loadSlots();
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
loadSlots();
setInterval(loadSlots, 30000);
