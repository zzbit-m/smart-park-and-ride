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
  showLoginOverlay();
}

/* ── Handle 401 from any API call (token expired / revoked) ── */
function handle401() {
  clearToken();
  localStorage.removeItem('adminRole');
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
  const panelScanner   = getEl('panel-scanner');
  const panelDashboard = getEl('panel-dashboard');

  if (!tabScanner || !tabDashboard) return;

  function activateTab(tab) {
    const isScanner = (tab === tabScanner);

    // Update tab buttons
    tabScanner.classList.toggle('admin-tab--active', isScanner);
    tabScanner.setAttribute('aria-selected', String(isScanner));
    tabDashboard.classList.toggle('admin-tab--active', !isScanner);
    tabDashboard.setAttribute('aria-selected', String(!isScanner));

    // Show / hide panels
    panelScanner.hidden   = !isScanner;
    panelDashboard.hidden = isScanner;

    // If leaving scanner → stop camera
    if (!isScanner && _cameraActive) stopCamera();

    // If entering dashboard → fetch fresh stats
    if (!isScanner) { fetchStats(); fetchSummary(); }
  }

  tabScanner.addEventListener('click',   () => activateTab(tabScanner));
  tabDashboard.addEventListener('click', () => activateTab(tabDashboard));
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

