/* ─────────────────────────────────────────────────────
   admin.js — Gate Scanner Logic + Auth
   Login         : POST {API_BASE}/api/admin/login
   Scan-In       : POST {API_BASE}/api/slots/scan        (Auth required)
   Scan-Out      : POST {API_BASE}/api/slots/scan-out    (Auth required)
   Manual Release: POST {API_BASE}/api/slots/manual-release (Auth required)
   API_BASE is read from window.APP_CONFIG (set by config.js).
───────────────────────────────────────────────────── */

// API_BASE is set by frontend/config.js (loaded before this script).
// Falls back to localhost for safety if config.js is missing.
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || 'http://localhost:8000';
const API_LOGIN = `${API_BASE}/api/admin/login`;
const API_SCAN_IN = `${API_BASE}/api/slots/scan`;
const API_SCAN_OUT = `${API_BASE}/api/slots/scan-out`;
const API_MANUAL_RELEASE = `${API_BASE}/api/slots/manual-release`;
const API_STATS = `${API_BASE}/api/admin/stats`;
const API_ANALYTICS = `${API_BASE}/api/slots/analytics`;
const API_EXPORT_SUMMARY = `${API_BASE}/api/admin/export/summary`;
const API_LAYOUT_CURRENT = `${API_BASE}/api/admin/layout/current`;
const API_LAYOUT_DIFF    = `${API_BASE}/api/admin/layout/diff`;
const API_LAYOUT_UPLOAD  = `${API_BASE}/api/admin/layout/upload`;

const TOKEN_KEY = 'adminToken';

/* ══════════════════════════════════════════════════════
   AUTH — Login / Logout
══════════════════════════════════════════════════════ */

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`,
  };
}

/* ── Show / hide views ── */
function showDashboard() {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('admin-dashboard').hidden = false;
  
  // Show/hide export-btn based on role
  const role = localStorage.getItem('adminRole');
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.hidden = (role !== 'admin');
  }

  // Focus QR input once the dashboard is visible
  setTimeout(() => {
    const inp = document.getElementById('qr-input');
    if (inp) inp.focus();
  }, 80);

  initLiveUpdates();
}

function showLoginOverlay(errorMsg = '') {
  document.getElementById('admin-dashboard').hidden = true;
  document.getElementById('login-overlay').style.display = 'flex';
  if (errorMsg) {
    document.getElementById('login-error').textContent = errorMsg;
  }
  setTimeout(() => {
    const inp = document.getElementById('login-username');
    if (inp) inp.focus();
  }, 80);
}

/* ── Login form submission ── */
async function performLogin(e) {
  e.preventDefault();

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');
  const btnText = document.getElementById('login-btn-text');

  if (!username || !password) {
    errorEl.textContent = '⚠️ กรุณากรอก Username และ Password';
    return;
  }

  // Loading state
  loginBtn.disabled = true;
  btnText.textContent = 'กำลังตรวจสอบ...';
  errorEl.textContent = '';

  try {
    const res = await fetch(API_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      const data = await res.json();
      saveToken(data.token);
      localStorage.setItem('adminRole', data.role);
      showDashboard();
    } else {
      const errData = await res.json().catch(() => ({}));
      errorEl.textContent = `❌ ${errData.detail || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'}`;
      document.getElementById('login-password').value = '';
      document.getElementById('login-password').focus();
    }

  } catch (err) {
    errorEl.textContent = '🔌 เชื่อมต่อ Server ไม่ได้ (Network Error)';
    console.error('[Admin/Login] Network error:', err);
  } finally {
    loginBtn.disabled = false;
    btnText.textContent = 'เข้าสู่ระบบ →';
  }
}

/* ── Logout ── */
function performLogout() {
  clearToken();
  localStorage.removeItem('adminRole');
  // Reset form fields
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
  closeLiveUpdates();
  showLoginOverlay();
}

/* ── Handle 401 from any API call (token expired / revoked) ── */
function handle401() {
  clearToken();
  localStorage.removeItem('adminRole');
  closeLiveUpdates();
  showLoginOverlay('⚠️ Session หมดอายุ — กรุณาเข้าสู่ระบบใหม่');
}

/* ══════════════════════════════════════════════════════
   SCANNER LOGIC (unchanged, now with auth headers)
══════════════════════════════════════════════════════ */

/* ── DOM references (resolved lazily after dashboard is shown) ── */
function getEl(id) { return document.getElementById(id); }

/* ── Scan history (in-memory, session only) ── */
const history = [];

/* ── Show result message in scanner card ── */
function showResult(type, message) {
  const scanResult = getEl('scan-result');
  scanResult.className = 'scan-result';
  scanResult.classList.add('scan-result--visible', `scan-result--${type}`);
  scanResult.textContent = message;

  clearTimeout(scanResult._hideTimer);
  scanResult._hideTimer = setTimeout(() => {
    scanResult.classList.remove('scan-result--visible');
  }, 6000);
}

/* ── Add entry to scan log ── */
function addLogEntry(token, success, message, mode = 'in') {
  const scanLog = getEl('scan-log');
  const now = new Date();
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const shortToken = token.length > 20 ? token.slice(0, 10) + '…' + token.slice(-6) : token;
  const modeLabel = mode === 'out' ? '[OUT]' : mode === 'manual' ? '[MANUAL]' : '[IN]  ';

  history.unshift({ token, success, message, timeStr, mode });

  const emptyEl = scanLog.querySelector('.log-empty');
  if (emptyEl) emptyEl.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry log-entry--${success ? 'success' : 'error'}`;
  entry.innerHTML = `
    <span class="log-entry-icon">${success ? '✅' : '❌'}</span>
    <div class="log-entry-body">
      <span class="log-entry-token">
        <span class="log-mode-badge log-mode-badge--${mode}">${modeLabel}</span>
        ${shortToken}
      </span>
      <span class="log-entry-msg">${message}</span>
    </div>
    <span class="log-entry-time">${timeStr}</span>
  `;

  scanLog.insertBefore(entry, scanLog.firstChild);

  const entries = scanLog.querySelectorAll('.log-entry');
  if (entries.length > 20) entries[entries.length - 1].remove();
}

/* ── Set button loading state ── */
function setLoading(btn, isLoading, defaultLabel) {
  btn.disabled = isLoading;
  btn.classList.toggle('btn-scan--loading', isLoading);
  const textEl = btn.querySelector('.btn-scan-text');
  if (textEl) textEl.textContent = isLoading ? 'กำลังตรวจสอบ...' : defaultLabel;
  const others = [getEl('scan-btn'), getEl('scan-out-btn'), getEl('manual-release-btn')].filter(b => b && b !== btn);
  others.forEach(b => { b.disabled = isLoading; });
}

/* ── Generic fetch helper (includes auth header) ── */
async function doScan(apiUrl, token, btn, defaultLabel, mode) {
  setLoading(btn, true, defaultLabel);
  getEl('scan-result').classList.remove('scan-result--visible');

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ qr_token: token }),
    });

    if (response.status === 401) { handle401(); return; }

    if (response.ok) {
      const data = await response.json();
      let successMsg;
      if (mode === 'in') {
        successMsg = '✅ เปิดไม้กั้นสำเร็จ! (Gate Opened)';
      } else {
        const slotCode = data.slot_code ?? '';
        successMsg = `✅ สแกนออกสำเร็จ! คืนพื้นที่ช่องจอด ${slotCode}`.trim();
      }

      showResult('success', successMsg);
      addLogEntry(token, true, successMsg.replace(/^✅ /, ''), mode);
      const qrInput = getEl('qr-input');
      qrInput.value = '';
      getEl('clear-btn').style.opacity = '0';
      getEl('clear-btn').style.pointerEvents = 'none';
      qrInput.focus();

      document.body.classList.add('gate-open');
      setTimeout(() => document.body.classList.remove('gate-open'), 800);

    } else {
      let detail = mode === 'in' ? 'รหัสไม่ถูกต้องหรือหมดอายุ' : 'ไม่พบข้อมูลการจอด หรือได้สแกนออกแล้ว';
      try {
        const errData = await response.json();
        if (errData.detail) detail = errData.detail;
      } catch (_) { /* ignore */ }

      showResult('error', `❌ ${detail}`);
      addLogEntry(token, false, detail, mode);
      getEl('qr-input').select();
    }

  } catch (err) {
    const netMsg = '🔌 ไม่สามารถเชื่อมต่อ Server ได้ (Network Error)';
    showResult('error', netMsg);
    addLogEntry(token, false, 'Network Error', mode);
    console.error(`[Admin Scanner/${mode}] Network error:`, err);
  } finally {
    setLoading(btn, false, defaultLabel);
  }
}

/* ── Scan-In ── */
async function performScanIn() {
  const token = getEl('qr-input').value.trim();
  if (!token) { showResult('error', '⚠️ กรุณากรอก QR Token ก่อนกดสแกน'); getEl('qr-input').focus(); return; }
  await doScan(API_SCAN_IN, token, getEl('scan-btn'), 'เปิดไม้กั้น (Scan In)', 'in');
}

/* ── Scan-Out ── */
async function performScanOut() {
  const token = getEl('qr-input').value.trim();
  if (!token) { showResult('error', '⚠️ กรุณากรอก QR Token ก่อนกดสแกนออก'); getEl('qr-input').focus(); return; }
  await doScan(API_SCAN_OUT, token, getEl('scan-out-btn'), 'สแกนรถออก (Scan Out)', 'out');
}

/* ── Manual Release ── */
async function performManualRelease() {
  const slotCode = getEl('manual-slot-input').value.trim().toUpperCase();
  if (!slotCode) {
    showManualResult('error', '⚠️ กรุณากรอกรหัสช่องจอดก่อน');
    getEl('manual-slot-input').focus();
    return;
  }

  const manualReleaseBtn = getEl('manual-release-btn');
  manualReleaseBtn.disabled = true;
  manualReleaseBtn.classList.add('btn-manual-release--loading');
  const textEl = manualReleaseBtn.querySelector('.btn-manual-text');
  textEl.textContent = 'กำลังปลดล็อก...';
  [getEl('scan-btn'), getEl('scan-out-btn')].forEach(b => { b.disabled = true; });
  showManualResult('', '');

  try {
    const response = await fetch(API_MANUAL_RELEASE, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ slot_code: slotCode }),
    });

    if (response.status === 401) { handle401(); return; }

    if (response.ok) {
      const data = await response.json();
      const successMsg = `✅ ปลดล็อกช่องจอด ${data.slot_code} สำเร็จ`;
      showManualResult('success', successMsg);
      addLogEntry(slotCode, true, `ปลดล็อกช่อง ${data.slot_code} สำเร็จ`, 'manual');
      getEl('manual-slot-input').value = '';
      getEl('manual-slot-input').focus();
    } else {
      let detail = 'ไม่พบช่องจอด หรือไม่มีการจองที่ใช้งาน';
      try {
        const errData = await response.json();
        if (errData.detail) detail = errData.detail;
      } catch (_) { /* ignore */ }
      showManualResult('error', `❌ ${detail}`);
      addLogEntry(slotCode, false, detail, 'manual');
      getEl('manual-slot-input').select();
    }

  } catch (err) {
    showManualResult('error', '🔌 ไม่สามารถเชื่อมต่อ Server ได้ (Network Error)');
    addLogEntry(slotCode, false, 'Network Error', 'manual');
    console.error('[Admin/Manual] Network error:', err);
  } finally {
    manualReleaseBtn.disabled = false;
    manualReleaseBtn.classList.remove('btn-manual-release--loading');
    textEl.textContent = 'บังคับเคลียร์ช่องจอด';
    [getEl('scan-btn'), getEl('scan-out-btn')].forEach(b => { b.disabled = false; });
  }
}

/* ── Show result in the manual override result box ── */
function showManualResult(type, message) {
  const manualResult = getEl('manual-result');
  manualResult.className = 'scan-result';
  if (!type && !message) return;
  manualResult.classList.add('scan-result--visible', `scan-result--${type}`);
  manualResult.textContent = message;

  clearTimeout(manualResult._hideTimer);
  manualResult._hideTimer = setTimeout(() => {
    manualResult.classList.remove('scan-result--visible');
  }, 6000);
}

/* ── Export Data ── */
async function performExport() {
  const btn = document.getElementById('export-btn');
  if (!btn) return;

  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Downloading...';

  try {
    const response = await fetch(`${API_BASE}/api/admin/export`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (response.status === 401) {
      handle401();
      return;
    }

    if (response.status === 403) {
      alert('❌ Permission Denied: Only administrators can export system data.');
      return;
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      alert(`❌ Export failed: ${errData.detail || response.statusText}`);
      return;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `smart_park_export_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

  } catch (err) {
    console.error('[Admin/Export] Error exporting data:', err);
    alert('🔌 Export failed due to network error.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

/* ══════════════════════════════════════════════════════
   EVENT WIRING — deferred until DOMContentLoaded
══════════════════════════════════════════════════════ */

window.addEventListener('DOMContentLoaded', () => {

  /* ── Auth: check for an existing token on page load ── */
  if (getToken()) {
    showDashboard();
  } else {
    showLoginOverlay();
  }

  /* ── Login form ── */
  getEl('login-form').addEventListener('submit', performLogin);

  /* ── Password show/hide toggle ── */
  getEl('toggle-pw').addEventListener('click', () => {
    const pwInput = getEl('login-password');
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
  });

  /* ── Export ── */
  const exportBtn = getEl('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', performExport);
  }

  /* ── Logout ── */
  getEl('logout-btn').addEventListener('click', performLogout);

  /* ── Scanner buttons ── */
  getEl('scan-btn').addEventListener('click', performScanIn);
  getEl('scan-out-btn').addEventListener('click', performScanOut);
  getEl('manual-release-btn').addEventListener('click', performManualRelease);

  /* ── Manual slot input: Enter key ── */
  getEl('manual-slot-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); performManualRelease(); }
  });

  /* ── QR input: Enter key → Scan-In ── */
  getEl('qr-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); performScanIn(); }
  });

  /* ── Clear input button ── */
  getEl('clear-btn').addEventListener('click', () => {
    const qrInput = getEl('qr-input');
    qrInput.value = '';
    getEl('scan-result').classList.remove('scan-result--visible');
    getEl('clear-btn').style.opacity = '0';
    getEl('clear-btn').style.pointerEvents = 'none';
    qrInput.focus();
  });

  /* ── Show/hide clear button based on QR input ── */
  getEl('qr-input').addEventListener('input', () => {
    const hasVal = !!getEl('qr-input').value;
    getEl('clear-btn').style.opacity = hasVal ? '1' : '0';
    getEl('clear-btn').style.pointerEvents = hasVal ? 'auto' : 'none';
  });

  /* ── Clear scan log ── */
  getEl('clear-log-btn').addEventListener('click', () => {
    getEl('scan-log').innerHTML = '<div class="log-empty">ยังไม่มีการสแกน</div>';
    history.length = 0;
  });

  /* ── Init clear button state ── */
  getEl('clear-btn').style.opacity = '0';
  getEl('clear-btn').style.pointerEvents = 'none';

  /* ── Camera scanner wiring ── */
  initCameraScanner();

  /* ── Tab navigation ── */
  initTabNav();

  /* ── Dashboard module ── */
  initDashboard();

  /* ── Layout module ── */
  initLayoutTab();
});

/* ══════════════════════════════════════════════════════
   CAMERA QR SCANNER  (html5-qrcode v2)
   - Toggle open/close camera with one button
   - On successful decode → show decoded panel, stop scanning
   - Admin chooses Scan-In or Scan-Out from decoded panel
   - Rescan button restarts the reader for next ticket
══════════════════════════════════════════════════════ */

let _html5QrCode = null;  // singleton scanner instance
let _cameraActive = false;
let _lastDecodedToken = '';

const CAMERA_CONFIG = {
  fps: 10,
  qrbox: { width: 240, height: 240 },
  aspectRatio: 1.0,
  showTorchButtonIfSupported: true,
  showZoomSliderIfSupported: true,
};

function initCameraScanner() {
  const toggleBtn = getEl('camera-toggle-btn');
  const camScanInBtn = getEl('cam-scan-in-btn');
  const camScanOutBtn = getEl('cam-scan-out-btn');
  const camRescanBtn = getEl('cam-rescan-btn');

  if (!toggleBtn) return; // camera card not in DOM

  toggleBtn.addEventListener('click', () => {
    if (_cameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  if (camScanInBtn) camScanInBtn.addEventListener('click', () => handleCameraAction('in'));
  if (camScanOutBtn) camScanOutBtn.addEventListener('click', () => handleCameraAction('out'));
  if (camRescanBtn) camRescanBtn.addEventListener('click', resumeCamera);
}

/* ── Start camera ── */
async function startCamera() {
  const readerWrap = getEl('qr-reader-wrap');
  const toggleBtn = getEl('camera-toggle-btn');
  const toggleText = getEl('camera-toggle-text');
  const laser = getEl('camera-laser');
  const hint = getEl('camera-hint');
  const decodedPanel = getEl('camera-decoded');
  const cameraCard = getEl('camera-card');

  // Reset decoded panel
  decodedPanel.hidden = true;
  _lastDecodedToken = '';

  // Show viewfinder
  readerWrap.hidden = false;

  // Update toggle button → "Stop"
  toggleBtn.classList.add('btn-camera-toggle--active');
  toggleText.textContent = 'ปิดกล้อง';
  toggleBtn.querySelector('.btn-camera-icon').textContent = '⏹';
  if (hint) hint.textContent = 'กำลังสแกน… ชี้ QR Code เข้าหากล้อง';

  // Laser on
  if (laser) laser.classList.add('camera-laser--active');

  try {
    _html5QrCode = new Html5Qrcode('qr-reader');
    await _html5QrCode.start(
      { facingMode: 'environment' },
      CAMERA_CONFIG,
      onQrDecodeSuccess,
      /* onScanFailure */() => { /* silent — fires every frame */ }
    );
    _cameraActive = true;

    // Flash the card border green briefly on start
    cameraCard.style.transition = 'border-color 0.3s';
    cameraCard.style.borderColor = 'rgba(0,229,160,0.5)';
    setTimeout(() => { cameraCard.style.borderColor = ''; }, 800);

  } catch (err) {
    console.error('[Camera] start error:', err);
    readerWrap.hidden = true;
    laser.classList.remove('camera-laser--active');
    toggleBtn.classList.remove('btn-camera-toggle--active');
    toggleText.textContent = 'เปิดกล้อง';
    toggleBtn.querySelector('.btn-camera-icon').textContent = '▶';
    if (hint) hint.textContent = '⚠️ ไม่สามารถเข้าถึงกล้องได้ — ตรวจสอบสิทธิ์ใน Browser';
    _cameraActive = false;
  }
}

/* ── Stop camera completely ── */
async function stopCamera() {
  const readerWrap = getEl('qr-reader-wrap');
  const laser = getEl('camera-laser');
  const toggleBtn = getEl('camera-toggle-btn');
  const toggleText = getEl('camera-toggle-text');
  const hint = getEl('camera-hint');

  if (_html5QrCode) {
    try {
      await _html5QrCode.stop();
      _html5QrCode.clear();
    } catch (_) { /* ignore if already stopped */ }
    _html5QrCode = null;
  }

  _cameraActive = false;
  readerWrap.hidden = true;
  laser.classList.remove('camera-laser--active');
  toggleBtn.classList.remove('btn-camera-toggle--active');
  toggleText.textContent = 'เปิดกล้อง';
  toggleBtn.querySelector('.btn-camera-icon').textContent = '▶';
  if (hint) hint.textContent = 'กด เปิดกล้อง แล้วชี้ QR Code เข้าหากล้อง';
}

/* ── Resume camera after an action (Rescan) ── */
async function resumeCamera() {
  const decodedPanel = getEl('camera-decoded');
  decodedPanel.hidden = true;
  _lastDecodedToken = '';
  // Clear the decoded token display
  const tokenEl = getEl('camera-decoded-token');
  if (tokenEl) tokenEl.textContent = '—';

  // Restart — stop first if somehow still running
  await stopCamera();
  await startCamera();
}

/* ── Called by html5-qrcode on every successful decode ── */
function onQrDecodeSuccess(decodedText) {
  const token = decodedText.trim();
  if (!token) return;
  if (token === _lastDecodedToken) return; // deduplicate rapid fires

  _lastDecodedToken = token;

  // Pause scanning (keep camera alive but ignore further results)
  if (_html5QrCode) {
    _html5QrCode.pause(/* shouldPauseVideo= */ false);
  }

  // Stop laser animation while awaiting admin action
  const laser = getEl('camera-laser');
  if (laser) laser.classList.remove('camera-laser--active');

  // Populate the decoded panel
  const tokenEl = getEl('camera-decoded-token');
  if (tokenEl) {
    const short = token.length > 24
      ? token.slice(0, 10) + '…' + token.slice(-8)
      : token;
    tokenEl.textContent = short;
    tokenEl.title = token;
  }

  // Also populate the manual fallback input (enables Enter-to-scan flow)
  const qrInput = getEl('qr-input');
  if (qrInput) {
    qrInput.value = token;
    // Trigger the input event so the clear button appears
    qrInput.dispatchEvent(new Event('input'));
  }

  // Show the decoded action panel
  getEl('camera-decoded').hidden = false;

  // Flash the camera card
  const cameraCard = getEl('camera-card');
  if (cameraCard) {
    cameraCard.classList.add('camera-card--flash');
    setTimeout(() => cameraCard.classList.remove('camera-card--flash'), 700);
  }

  const hint = getEl('camera-hint');
  if (hint) hint.textContent = '✅ QR พบแล้ว — เลือก Scan In หรือ Scan Out';
}

/* ── Handle Scan-In or Scan-Out from the decoded panel ── */
async function handleCameraAction(mode) {
  const token = _lastDecodedToken;
  if (!token) return;

  const inBtn = getEl('cam-scan-in-btn');
  const outBtn = getEl('cam-scan-out-btn');

  // Disable both camera action buttons during request
  if (inBtn) inBtn.disabled = true;
  if (outBtn) outBtn.disabled = true;

  const apiUrl = mode === 'in' ? API_SCAN_IN : API_SCAN_OUT;
  const defaultLbl = mode === 'in' ? 'เปิดไม้กั้น (Scan In)' : 'สแกนรถออก (Scan Out)';
  const manualBtn = getEl(mode === 'in' ? 'scan-btn' : 'scan-out-btn');

  await doScan(apiUrl, token, manualBtn, defaultLbl, mode);

  // Re-enable cam buttons
  if (inBtn) inBtn.disabled = false;
  if (outBtn) outBtn.disabled = false;

  // After a successful action, stop the camera so staff can prepare next scan
  await stopCamera();
  getEl('camera-decoded').hidden = true;
  _lastDecodedToken = '';
}

/* ══════════════════════════════════════════════════════
   TAB NAVIGATION
   Switches between #panel-scanner and #panel-dashboard.
   Stops the camera automatically when leaving the Scanner tab.
══════════════════════════════════════════════════════ */

function initTabNav() {
  const tabScanner   = getEl('tab-scanner');
  const tabDashboard = getEl('tab-dashboard');
  const tabLayout    = getEl('tab-layout');
  const panelScanner   = getEl('panel-scanner');
  const panelDashboard = getEl('panel-dashboard');
  const panelLayout    = getEl('panel-layout');

  if (!tabScanner || !tabDashboard) return;

  function activateTab(tab) {
    const isScanner   = (tab === tabScanner);
    const isDashboard = (tab === tabDashboard);
    const isLayout    = (tab === tabLayout);

    tabScanner.classList.toggle('admin-tab--active', isScanner);
    tabScanner.setAttribute('aria-selected', String(isScanner));
    tabDashboard.classList.toggle('admin-tab--active', isDashboard);
    tabDashboard.setAttribute('aria-selected', String(isDashboard));
    if (tabLayout) {
      tabLayout.classList.toggle('admin-tab--active', isLayout);
      tabLayout.setAttribute('aria-selected', String(isLayout));
    }

    panelScanner.hidden   = !isScanner;
    panelDashboard.hidden = !isDashboard;
    if (panelLayout) panelLayout.hidden = !isLayout;

    if (!isScanner && _cameraActive) stopCamera();

    if (isDashboard) { fetchStats(); fetchSummary(); }
    if (isLayout) { fetchCurrentLayout(); }
  }

  tabScanner.addEventListener('click',   () => activateTab(tabScanner));
  tabDashboard.addEventListener('click', () => activateTab(tabDashboard));
  if (tabLayout) {
    tabLayout.addEventListener('click', () => {
      window.location.href = `${API_BASE}/admin-layout/`;
    });
  }
}

/* ══════════════════════════════════════════════════════
   DASHBOARD MODULE — Chart.js doughnut + KPI cards
   GET /api/admin/stats  (Bearer token required)
   Auto-refreshes every 30 s while dashboard panel is visible.
══════════════════════════════════════════════════════ */

let _statsChart      = null;  // Chart.js instance (singleton)
let _peakHoursChart  = null;
let _dailyTrafficChart = null;
let _dashRefreshTimer = null;

const DASH_REFRESH_MS = 30_000; // 30 seconds

const CHART_COLORS = {
  available: '#00e5a0',
  held:      '#f5c542',
  occupied:  '#ff4d6d',
  empty:     'rgba(255,255,255,0.06)',
};

function initDashboard() {
  const refreshBtn = getEl('dash-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ Refreshing…';
      fetchStats().finally(() => {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Refresh';
      });
    });
  }

  // Build the charts once (on empty data) so the canvases are ready
  buildChart({ total: 0, available: 0, held: 0, occupied: 0 });
  buildPeakHoursChart([]);
  buildDailyTrafficChart([]);

  // Set default date input to today
  const dateInput = getEl('summary-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().slice(0, 10);
    dateInput.addEventListener('change', fetchSummary);
  }

  const rangeSelect = getEl('summary-range');
  if (rangeSelect) {
    rangeSelect.addEventListener('change', fetchSummary);
  }

  const summaryBtn = getEl('summary-refresh-btn');
  if (summaryBtn) {
    summaryBtn.addEventListener('click', fetchSummary);
  }

  const downloadBtn = getEl('summary-download-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadSummary);
  }

  // Start auto-refresh (only ticks; actual fetch triggered on tab switch)
  _dashRefreshTimer = setInterval(() => {
    // Only fetch if the dashboard panel is currently visible
    const panel = getEl('panel-dashboard');
    if (panel && !panel.hidden) fetchStats();
  }, DASH_REFRESH_MS);
}

/* ── Fetch stats from the backend ── */
async function fetchStats() {
  const lastUpdatedEl = getEl('dash-last-updated');
  if (lastUpdatedEl) lastUpdatedEl.textContent = 'กำลังโหลด…';

  try {
    const [statsRes, analyticsRes] = await Promise.all([
      fetch(API_STATS, {
        method: 'GET',
        headers: authHeaders(),
      }),
      fetch(API_ANALYTICS, {
        method: 'GET',
        headers: authHeaders(),
      })
    ]);

    if (statsRes.status === 401 || analyticsRes.status === 401) {
      handle401();
      return;
    }

    if (!statsRes.ok) {
      const err = await statsRes.json().catch(() => ({}));
      console.error('[Dashboard] stats error:', err);
      if (lastUpdatedEl) lastUpdatedEl.textContent = `⚠️ โหลดข้อมูลไม่ได้ (${statsRes.status})`;
      return;
    }

    if (!analyticsRes.ok) {
      const err = await analyticsRes.json().catch(() => ({}));
      console.error('[Dashboard] analytics error:', err);
      if (lastUpdatedEl) lastUpdatedEl.textContent = `⚠️ โหลดข้อมูลไม่ได้ (${analyticsRes.status})`;
      return;
    }

    const statsData = await statsRes.json();
    const analyticsData = await analyticsRes.json();

    // ── 1. Live status stats ──
    updateKpiCards(statsData);
    updateChart(statsData);
    updateLegend(statsData);

    // ── 2. Historical analytics ──
    const avgMin = analyticsData.average_duration_minutes ?? 0;
    const durationText = avgMin > 0 ? `${avgMin.toFixed(1)} ม.` : '—';
    const setTxt = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };
    setTxt('kpi-avg-duration', durationText);
    setTxt('kpi-completed',    analyticsData.summary_stats?.total_completed ?? 0);
    setTxt('kpi-cancelled',    analyticsData.summary_stats?.total_cancelled ?? 0);

    buildPeakHoursChart(analyticsData.peak_hours || []);
    buildDailyTrafficChart(analyticsData.daily_traffic || []);

    const now = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (lastUpdatedEl) lastUpdatedEl.textContent = `อัปเดตล่าสุด: ${now}  ·  Auto-refresh ทุก 30 วิ`;

  } catch (err) {
    console.error('[Dashboard] Network error:', err);
    if (lastUpdatedEl) lastUpdatedEl.textContent = '🔌 เชื่อมต่อ Server ไม่ได้';
  }
}

/* ── Fetch export summary ── */
async function fetchSummary() {
  const dateInput = getEl('summary-date');
  const rangeSelect = getEl('summary-range');
  const d = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
  const r = rangeSelect ? rangeSelect.value : 'day';
  if (!d) return;

  try {
    const res = await fetch(`${API_EXPORT_SUMMARY}?d=${d}&r=${r}`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (res.status === 401) { handle401(); return; }
    if (!res.ok) return;

    const data = await res.json();

    const setTxt = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };

    const subtitle = getEl('summary-subtitle');
    if (subtitle) subtitle.textContent = `${data.range || r} — ${data.date || d}`;

    setTxt('summary-total-cars', data.total_cars ?? '—');
    setTxt('summary-total-motorcycles', data.total_motorcycles ?? '—');
    setTxt('summary-avg-duration', data.average_duration_minutes != null ? `${data.average_duration_minutes.toFixed(1)} m` : '—');
    setTxt('summary-occupancy', data.occupancy_rate != null ? `${(data.occupancy_rate * 100).toFixed(1)}%` : '—');

    if (data.peak_hour) {
      setTxt('summary-peak-hour', `${String(data.peak_hour.hour).padStart(2, '0')}:00 (${data.peak_hour.count})`);
    } else {
      setTxt('summary-peak-hour', '—');
    }

    if (data.slot_utilization && data.slot_utilization.length > 0) {
      const top = data.slot_utilization[0];
      setTxt('summary-top-slot', `${top.slot_id} (${top.usage_count})`);
    } else {
      setTxt('summary-top-slot', '—');
    }
  } catch (err) {
    console.error('[Summary] Fetch error:', err);
  }
}

/* ── Download summary as JSON file ── */
async function downloadSummary() {
  const dateInput = getEl('summary-date');
  const rangeSelect = getEl('summary-range');
  const d = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
  const r = rangeSelect ? rangeSelect.value : 'day';
  if (!d) return;

  const btn = getEl('summary-download-btn');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '⏳';

  try {
    const res = await fetch(`${API_EXPORT_SUMMARY}?d=${d}&r=${r}`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (res.status === 401) { handle401(); return; }
    if (!res.ok) return;

    const data = await res.json();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parking_summary_${r}_${d}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[Summary] Download error:', err);
  } finally {
    if (btn) btn.innerHTML = originalText;
  }
}

/* ── Build Peak Hours Chart ── */
function buildPeakHoursChart(peakHours) {
  const canvas = getEl('peak-hours-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_peakHoursChart) {
    _peakHoursChart.destroy();
    _peakHoursChart = null;
  }

  const dataArray = Array(24).fill(0);
  peakHours.forEach(item => {
    if (item.hour >= 0 && item.hour < 24) {
      dataArray[item.hour] = item.count;
    }
  });

  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

  _peakHoursChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'จำนวนเช็คอิน',
        data: dataArray,
        backgroundColor: 'rgba(61, 139, 255, 0.75)',
        borderColor: '#3d8bff',
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.7,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,15,30,0.92)',
          titleColor: '#fff',
          bodyColor: 'rgba(255,255,255,0.75)',
          borderColor: 'rgba(61,139,255,0.2)',
          borderWidth: 1,
          padding: 10,
          titleFont: { family: 'Kanit' },
          bodyFont: { family: 'Kanit' },
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#6b7a99',
            font: { family: 'DM Mono', size: 9 },
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 8
          }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#6b7a99',
            font: { family: 'DM Mono', size: 9 },
            precision: 0
          }
        }
      }
    }
  });
}

/* ── Build Daily Traffic Chart ── */
function buildDailyTrafficChart(dailyTraffic) {
  const canvas = getEl('daily-traffic-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_dailyTrafficChart) {
    _dailyTrafficChart.destroy();
    _dailyTrafficChart = null;
  }

  const dayMap = {
    'Sunday': 'Sun',
    'Monday': 'Mon',
    'Tuesday': 'Tue',
    'Wednesday': 'Wed',
    'Thursday': 'Thu',
    'Friday': 'Fri',
    'Saturday': 'Sat'
  };

  const sortedTraffic = [...dailyTraffic].sort((a, b) => a.day_of_week - b.day_of_week);
  const labels = sortedTraffic.map(item => dayMap[item.day_name] || item.day_name);
  const dataArray = sortedTraffic.map(item => item.count);

  _dailyTrafficChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'จำนวนเช็คอิน',
        data: dataArray,
        backgroundColor: 'rgba(0, 229, 160, 0.75)',
        borderColor: '#00e5a0',
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,15,30,0.92)',
          titleColor: '#fff',
          bodyColor: 'rgba(255,255,255,0.75)',
          borderColor: 'rgba(0,229,160,0.2)',
          borderWidth: 1,
          padding: 10,
          titleFont: { family: 'Kanit' },
          bodyFont: { family: 'Kanit' },
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#6b7a99',
            font: { family: 'DM Mono', size: 10 }
          }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#6b7a99',
            font: { family: 'DM Mono', size: 10 },
            precision: 0
          }
        }
      }
    }
  });
}

/* ── Build Chart.js doughnut (called once) ── */
function buildChart(data) {
  const canvas = getEl('stats-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Destroy old instance if re-initialising
  if (_statsChart) { _statsChart.destroy(); _statsChart = null; }

  const hasData = (data.total > 0);
  _statsChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['ว่าง', 'จองแล้ว', 'มีรถจอด'],
      datasets: [{
        data: hasData
          ? [data.available, data.held, data.occupied]
          : [1, 0, 0],
        backgroundColor: hasData
          ? [CHART_COLORS.available, CHART_COLORS.held, CHART_COLORS.occupied]
          : [CHART_COLORS.empty],
        borderColor: '#111827',
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      cutout: '72%',
      animation: { duration: 600, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },  // we render our own legend
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
              return ` ${ctx.label}: ${ctx.parsed} ช่อง (${pct}%)`;
            },
          },
          backgroundColor: 'rgba(10,15,30,0.92)',
          titleColor: '#fff',
          bodyColor: 'rgba(255,255,255,0.75)',
          borderColor: 'rgba(61,139,255,0.2)',
          borderWidth: 1,
          padding: 10,
        },
      },
      responsive: true,
      maintainAspectRatio: true,
    },
  });
}

/* ── Update existing chart with fresh data ── */
function updateChart(data) {
  if (!_statsChart) { buildChart(data); return; }

  const hasData = (data.total > 0);
  _statsChart.data.datasets[0].data = hasData
    ? [data.available, data.held, data.occupied]
    : [1, 0, 0];
  _statsChart.data.datasets[0].backgroundColor = hasData
    ? [CHART_COLORS.available, CHART_COLORS.held, CHART_COLORS.occupied]
    : [CHART_COLORS.empty];
  _statsChart.update('active');

  // Update centre overlay
  const usedPct = data.total > 0
    ? Math.round(((data.held + data.occupied) / data.total) * 100)
    : 0;
  const centreEl = getEl('dash-centre-value');
  if (centreEl) centreEl.textContent = `${usedPct}%`;
}

/* ── Update the 4 KPI cards ── */
function updateKpiCards(data) {
  const set = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };
  set('kpi-total',     data.total);
  set('kpi-available', data.available);
  set('kpi-held',      data.held);
  set('kpi-occupied',  data.occupied);
}

/* ── Update legend percentage labels ── */
function updateLegend(data) {
  function pct(part) {
    return data.total > 0 ? `${Math.round((part / data.total) * 100)}%` : '—%';
  }
  const setTxt = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };
  setTxt('legend-available-pct', pct(data.available));
  setTxt('legend-held-pct',      pct(data.held));
  setTxt('legend-occupied-pct',  pct(data.occupied));
}

/* ══════════════════════════════════════════════════════
   LAYOUT MODULE — View current layout, preview diff, upload
   GET  /api/admin/layout/current
   POST /api/admin/layout/diff
   POST /api/admin/layout/upload
══════════════════════════════════════════════════════ */

let _layoutZoneCount = 0;

function initLayoutTab() {
  const refreshBtn = getEl('layout-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', fetchCurrentLayout);
  }

  getEl('layout-add-zone-btn').addEventListener('click', addLayoutZone);
  getEl('layout-preview-btn').addEventListener('click', previewLayout);
  getEl('layout-apply-btn').addEventListener('click', applyLayout);

  addLayoutZone(); // start with one empty zone row
}

/* ── Fetch current layout ── */
async function fetchCurrentLayout() {
  const subEl = getEl('layout-current-sub');
  const bodyEl = getEl('layout-current-body');
  if (subEl) subEl.textContent = 'Loading...';
  if (bodyEl) bodyEl.innerHTML = '';

  try {
    const res = await fetch(API_LAYOUT_CURRENT, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (res.status === 401) { handle401(); return; }

    if (!res.ok) {
      if (subEl) subEl.textContent = `Error ${res.status}`;
      return;
    }

    const data = await res.json();
    renderCurrentLayout(data);
  } catch (err) {
    console.error('[Layout] fetch error:', err);
    if (subEl) subEl.textContent = 'Network error';
  }
}

function renderCurrentLayout(data) {
  const subEl = getEl('layout-current-sub');
  const bodyEl = getEl('layout-current-body');
  if (!bodyEl) return;

  // Response is nested: { layout: { ... } } or directly the layout object
  const layout = data && data.layout ? data.layout : data;

  if (!layout) {
    if (subEl) subEl.textContent = 'No layout found';
    bodyEl.innerHTML = '<p style="color:#6b7a99;font-size:13px;padding:12px 0;">No layout applied yet.</p>';
    getEl('layout-version').value = 1;
    return;
  }

  const config = layout.config || {};
  const zones = config.zones || layout.zones || [];
  const zoneRows = zones.map(z =>
    `<tr><td style="color:#e8edf5;padding:4px 8px;">${z.zone_name}</td><td style="color:#8b9ab5;padding:4px 8px;">${z.rows} × ${z.cols}</td><td style="color:#8b9ab5;padding:4px 8px;">${z.slot_prefix}</td><td style="color:#8b9ab5;padding:4px 8px;">${z.slot_type || 'standard'}</td></tr>`
  ).join('');

  bodyEl.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;padding:12px 0;">
      <div><span style="color:#6b7a99;font-size:11px;">Version</span><br><span style="color:#e8edf5;font-size:20px;font-weight:600;">${layout.version || '—'}</span></div>
      <div><span style="color:#6b7a99;font-size:11px;">Label</span><br><span style="color:#e8edf5;font-size:16px;">${layout.label || '—'}</span></div>
      <div><span style="color:#6b7a99;font-size:11px;">Zones</span><br><span style="color:#e8edf5;font-size:20px;font-weight:600;">${zones.length}</span></div>
      <div><span style="color:#6b7a99;font-size:11px;">Layout ID</span><br><span style="color:#8b9ab5;font-size:14px;font-family:DM Mono;">${layout.id || '—'}</span></div>
    </div>
    ${zoneRows.length ? `
    <table style="width:100%;border-collapse:collapse;margin-top:4px;">
      <thead><tr style="border-bottom:1px solid #2a3a52;">
        <th style="color:#6b7a99;font-size:10px;text-align:left;padding:4px 8px;text-transform:uppercase;">Zone</th>
        <th style="color:#6b7a99;font-size:10px;text-align:left;padding:4px 8px;text-transform:uppercase;">Grid</th>
        <th style="color:#6b7a99;font-size:10px;text-align:left;padding:4px 8px;text-transform:uppercase;">Prefix</th>
        <th style="color:#6b7a99;font-size:10px;text-align:left;padding:4px 8px;text-transform:uppercase;">Type</th>
      </tr></thead>
      <tbody>${zoneRows}</tbody>
    </table>` : ''}
  `;

  if (subEl) subEl.textContent = `v${layout.version} — ${layout.label || 'Unnamed'}`;

  // Pre-fill form from current layout
  getEl('layout-version').value = (layout.version || 0) + 1;
  getEl('layout-label').value = `v${(layout.version || 0) + 1}`;

  // Clear existing zone rows and populate from current config
  const container = getEl('layout-zones-container');
  container.innerHTML = '';
  _layoutZoneCount = 0;
  if (zones.length) {
    zones.forEach(z => addLayoutZone(z));
  } else {
    addLayoutZone();
  }
}

/* ── Zone form row management ── */

function addLayoutZone(prefill) {
  _layoutZoneCount++;
  const id = _layoutZoneCount;
  const container = getEl('layout-zones-container');
  const row = document.createElement('div');
  row.id = `zone-row-${id}`;
  row.style.cssText = 'display:flex;gap:8px;align-items:end;padding:8px 0;border-bottom:1px solid #1e293b;flex-wrap:wrap;';

  const name = prefill ? prefill.zone_name || '' : '';
  const rows = prefill ? prefill.rows || 1 : 1;
  const cols = prefill ? prefill.cols || 5 : 5;
  const prefix = prefill ? prefill.slot_prefix || '' : '';
  const type = prefill ? prefill.slot_type || 'standard' : 'standard';

  row.innerHTML = `
    <div style="flex:2;min-width:100px;">
      <label style="color:#8b9ab5;font-size:11px;display:block;margin-bottom:4px;">ZONE NAME</label>
      <input id="zone-name-${id}" class="scan-input" style="width:100%;" placeholder="Zone A" value="${name}" />
    </div>
    <div style="flex:1;min-width:60px;">
      <label style="color:#8b9ab5;font-size:11px;display:block;margin-bottom:4px;">ROWS</label>
      <input id="zone-rows-${id}" type="number" min="1" class="scan-input" style="width:100%;" value="${rows}" />
    </div>
    <div style="flex:1;min-width:60px;">
      <label style="color:#8b9ab5;font-size:11px;display:block;margin-bottom:4px;">COLS</label>
      <input id="zone-cols-${id}" type="number" min="1" class="scan-input" style="width:100%;" value="${cols}" />
    </div>
    <div style="flex:1;min-width:60px;">
      <label style="color:#8b9ab5;font-size:11px;display:block;margin-bottom:4px;">PREFIX</label>
      <input id="zone-prefix-${id}" class="scan-input" style="width:100%;" placeholder="A" maxlength="5" value="${prefix}" />
    </div>
    <div style="flex:1;min-width:80px;">
      <label style="color:#8b9ab5;font-size:11px;display:block;margin-bottom:4px;">TYPE</label>
      <select id="zone-type-${id}" class="scan-input" style="width:100%;cursor:pointer;">
        <option value="standard" ${type === 'standard' ? 'selected' : ''}>Standard</option>
        <option value="disabled" ${type === 'disabled' ? 'selected' : ''}>Disabled</option>
        <option value="EV" ${type === 'EV' ? 'selected' : ''}>EV</option>
        <option value="motorcycle" ${type === 'motorcycle' ? 'selected' : ''}>Motorcycle</option>
      </select>
    </div>
    <button id="zone-remove-${id}" class="btn-manual-release" style="flex:0 0 auto;padding:6px 10px;" title="Remove zone">
      <span class="btn-manual-icon">✕</span>
    </button>
  `;
  container.appendChild(row);

  getEl(`zone-remove-${id}`).addEventListener('click', () => {
    row.remove();
    updateTotalSlots();
  });

  // Recalculate total when rows/cols change
  getEl(`zone-rows-${id}`).addEventListener('input', updateTotalSlots);
  getEl(`zone-cols-${id}`).addEventListener('input', updateTotalSlots);

  updateTotalSlots();
}

function updateTotalSlots() {
  const zones = collectLayoutZones();
  const total = zones.reduce((sum, z) => sum + (z.rows || 1) * (z.cols || 1), 0);
  const countEl = getEl('layout-total-count');
  if (countEl) countEl.textContent = total;
}

/* ── Collect zone data from form ── */
function collectLayoutZones() {
  const zones = [];
  const container = getEl('layout-zones-container');
  const rows = container.querySelectorAll('[id^="zone-row-"]');
  rows.forEach(row => {
    const id = row.id.replace('zone-row-', '');
    const nameEl = getEl(`zone-name-${id}`);
    const rowsEl = getEl(`zone-rows-${id}`);
    const colsEl = getEl(`zone-cols-${id}`);
    const prefixEl = getEl(`zone-prefix-${id}`);
    const typeEl = getEl(`zone-type-${id}`);
    if (!nameEl || !rowsEl || !colsEl || !prefixEl || !typeEl) return;
    const name = nameEl.value.trim();
    if (!name) return;
    zones.push({
      zone_name: name,
      rows: parseInt(rowsEl.value, 10) || 1,
      cols: parseInt(colsEl.value, 10) || 1,
      slot_prefix: prefixEl.value.trim().toUpperCase() || name.replace(/[^A-Z]/gi, '').slice(0, 1).toUpperCase(),
      slot_type: typeEl.value,
    });
  });
  return zones;
}

/* ── Preview layout diff ── */
async function previewLayout() {
  hideLayoutResult();
  const zones = collectLayoutZones();
  if (!zones.length) {
    showLayoutResult('error', '⚠️ Please add at least one zone.');
    return;
  }

  const version = parseInt(getEl('layout-version').value, 10) || 1;
  const label = getEl('layout-label').value.trim() || `Layout v${version}`;
  const config = { version, label, zones };

  const previewBtn = getEl('layout-preview-btn');
  previewBtn.disabled = true;
  previewBtn.querySelector('.btn-scan-text').textContent = 'Previewing...';

  try {
    const res = await fetch(API_LAYOUT_DIFF, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(config),
    });

    if (res.status === 401) { handle401(); return; }

    const data = await res.json();
    renderLayoutResult('diff', data);
  } catch (err) {
    console.error('[Layout] preview error:', err);
    showLayoutResult('error', '🔌 Network error — could not reach server.');
  } finally {
    previewBtn.disabled = false;
    previewBtn.querySelector('.btn-scan-text').textContent = 'Preview Diff';
  }
}

/* ── Apply layout ── */
async function applyLayout() {
  hideLayoutResult();
  const zones = collectLayoutZones();
  if (!zones.length) {
    showLayoutResult('error', '⚠️ Please add at least one zone.');
    return;
  }

  const version = parseInt(getEl('layout-version').value, 10) || 1;
  const label = getEl('layout-label').value.trim() || `Layout v${version}`;
  const config = { version, label, zones };

  const applyBtn = getEl('layout-apply-btn');
  applyBtn.disabled = true;
  applyBtn.querySelector('.btn-scan-text').textContent = 'Applying...';

  try {
    const res = await fetch(API_LAYOUT_UPLOAD, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(config),
    });

    if (res.status === 401) { handle401(); return; }

    const data = await res.json();
    renderLayoutResult(res.ok ? 'success' : 'error', data);
    if (res.ok) {
      // Refresh current layout info
      setTimeout(fetchCurrentLayout, 500);
    }
  } catch (err) {
    console.error('[Layout] apply error:', err);
    showLayoutResult('error', '🔌 Network error — could not reach server.');
  } finally {
    applyBtn.disabled = false;
    applyBtn.querySelector('.btn-scan-text').textContent = 'Apply Layout';
  }
}

/* ── Render diff/result in the result box ── */
function renderLayoutResult(type, data) {
  const el = getEl('layout-result');
  el.className = 'scan-result scan-result--visible';

  if (type === 'error') {
    el.classList.add('scan-result--error');
    const detail = data.detail || data.message || 'Unknown error';
    if (typeof detail === 'object') {
      const conflicts = detail.conflicts || [];
      let html = `<div style="font-size:14px;font-weight:600;margin-bottom:8px;">❌ Layout rejected</div>`;
      html += `<div style="display:flex;gap:16px;font-size:13px;margin-bottom:6px;">
        <span>${detail.slots_created || 0} created</span>
        <span style="color:#ff4d6d;">${detail.slots_removed || 0} removed</span>
        <span>${detail.slots_unchanged || 0} unchanged</span>
      </div>`;
      if (conflicts.length) {
        html += `<div style="background:rgba(255,77,109,0.1);border:1px solid #ff4d6d;border-radius:6px;padding:8px;margin-top:6px;font-size:12px;color:#ff4d6d;">
          ⚠️ ${conflicts.length} conflict(s) — active bookings on: ${conflicts.map(c => c.slot_code).join(', ')}
        </div>`;
        html += '<p style="color:#ff4d6d;font-size:11px;margin-top:4px;">Release or complete these bookings before applying.</p>';
      }
      el.innerHTML = html;
    } else {
      el.innerHTML = `❌ ${detail}`;
    }
    return;
  }

  if (type === 'diff') {
    const created = data.slots_to_create || [];
    const removed = data.slots_to_remove || [];
    const conflicts = data.conflicts || [];
    const unchanged = data.unchanged || 0;

    el.classList.add('scan-result--success');

    let html = `<div style="font-size:14px;font-weight:600;margin-bottom:8px;">🔍 Preview — ${data.dry_run ? 'Dry run' : 'Result'}</div>`;

    if (conflicts.length) {
      html += `<div style="background:rgba(255,77,109,0.1);border:1px solid #ff4d6d;border-radius:6px;padding:8px;margin-bottom:8px;font-size:12px;color:#ff4d6d;">
        ⚠️ ${conflicts.length} conflict(s) — active bookings on: ${conflicts.map(c => c.slot_code).join(', ')}
      </div>`;
    }

    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tbody>';
    html += `<tr style="border-bottom:1px solid #2a3a52;"><td style="padding:4px 8px;color:#8b9ab5;">Version</td><td style="padding:4px 8px;color:#e8edf5;">${data.version || '—'}</td></tr>`;
    html += `<tr style="border-bottom:1px solid #2a3a52;"><td style="padding:4px 8px;color:#8b9ab5;">Zones</td><td style="padding:4px 8px;color:#e8edf5;">${data.zones || '—'}</td></tr>`;
    html += `<tr style="border-bottom:1px solid #2a3a52;"><td style="padding:4px 8px;color:#8b9ab5;">Slots to create</td><td style="padding:4px 8px;color:#00e5a0;">${created.length}</td></tr>`;
    html += created.length ? `<tr style="border-bottom:1px solid #2a3a52;"><td style="padding:4px 8px;color:#8b9ab5;"></td><td style="padding:4px 8px;font-family:DM Mono;font-size:11px;color:#6b7a99;word-break:break-all;">${created.join(', ')}</td></tr>` : '';
    html += `<tr style="border-bottom:1px solid #2a3a52;"><td style="padding:4px 8px;color:#8b9ab5;">Slots to remove</td><td style="padding:4px 8px;color:#ff4d6d;">${removed.length}</td></tr>`;
    html += removed.length ? `<tr style="border-bottom:1px solid #2a3a52;"><td style="padding:4px 8px;color:#8b9ab5;"></td><td style="padding:4px 8px;font-family:DM Mono;font-size:11px;color:#6b7a99;word-break:break-all;">${removed.join(', ')}</td></tr>` : '';
    html += `<tr><td style="padding:4px 8px;color:#8b9ab5;">Unchanged</td><td style="padding:4px 8px;color:#e8edf5;">${unchanged}</td></tr>`;
    html += '</tbody></table>';

    if (conflicts.length) {
      html += '<p style="color:#ff4d6d;font-size:11px;margin-top:8px;">⚠️ Resolve conflicts before applying.</p>';
    }

    el.innerHTML = html;
    return;
  }

  if (type === 'success') {
    el.classList.add('scan-result--success');
    const created = data.slots_created || 0;
    const removed = data.slots_removed || 0;
    const unchanged = data.slots_unchanged || 0;
    const version = data.version || '—';
    el.innerHTML = `
      <div style="font-size:14px;font-weight:600;margin-bottom:6px;">✅ Layout v${version} applied</div>
      <div style="display:flex;gap:16px;font-size:13px;">
        <span style="color:#00e5a0;">+${created} created</span>
        <span style="color:#ff4d6d;">−${removed} removed</span>
        <span style="color:#8b9ab5;">${unchanged} unchanged</span>
      </div>
    `;
  }
}

function showLayoutResult(type, message) {
  const el = getEl('layout-result');
  el.className = 'scan-result scan-result--visible';
  el.classList.add(`scan-result--${type}`);
  el.textContent = message;

  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove('scan-result--visible');
  }, 8000);
}

function hideLayoutResult() {
  const el = getEl('layout-result');
  el.className = 'scan-result';
  el.innerHTML = '';
  clearTimeout(el._hideTimer);
}

/* ── Live Updates (SSE) ── */
let _sseEventSource = null;

function initLiveUpdates() {
  if (_sseEventSource) return;

  const sseUrl = `${API_BASE}/api/slots/live`;
  console.log(`[SSE/Admin] Connecting to live updates at: ${sseUrl}`);

  _sseEventSource = new EventSource(sseUrl);

  _sseEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[SSE/Admin] Received slot update:', data);

      const panel = document.getElementById('panel-dashboard');
      if (panel && !panel.hidden) {
        fetchStats();
      }
    } catch (err) {
      console.error('[SSE/Admin] Failed to parse message:', err);
    }
  };

  _sseEventSource.onerror = (err) => {
    console.warn('[SSE/Admin] Connection error. EventSource will auto-reconnect.', err);
  };
}

function closeLiveUpdates() {
  if (_sseEventSource) {
    console.log('[SSE/Admin] Closing connection');
    _sseEventSource.close();
    _sseEventSource = null;
  }
}

