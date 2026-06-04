/* ─────────────────────────────────────────────────────
   admin.js — Gate Scanner Logic
   Scan-In        : POST http://localhost:8000/api/slots/scan
   Scan-Out       : POST http://localhost:8000/api/slots/scan-out
   Manual Release : POST http://localhost:8000/api/slots/manual-release
───────────────────────────────────────────────────── */

const API_SCAN_IN       = 'http://localhost:8000/api/slots/scan';
const API_SCAN_OUT      = 'http://localhost:8000/api/slots/scan-out';
const API_MANUAL_RELEASE = 'http://localhost:8000/api/slots/manual-release';

const qrInput          = document.getElementById('qr-input');
const scanBtn          = document.getElementById('scan-btn');
const scanOutBtn       = document.getElementById('scan-out-btn');
const scanResult       = document.getElementById('scan-result');
const clearBtn         = document.getElementById('clear-btn');
const clearLogBtn      = document.getElementById('clear-log-btn');
const scanLog          = document.getElementById('scan-log');
const manualSlotInput  = document.getElementById('manual-slot-input');
const manualReleaseBtn = document.getElementById('manual-release-btn');
const manualResult     = document.getElementById('manual-result');

/* ── Scan history (in-memory, session only) ── */
const history = [];

/* ── Show result message ── */
function showResult(type, message) {
  scanResult.className = 'scan-result'; // reset classes
  scanResult.classList.add('scan-result--visible', `scan-result--${type}`);
  scanResult.textContent = message;

  // Auto-hide after 6 seconds
  clearTimeout(scanResult._hideTimer);
  scanResult._hideTimer = setTimeout(() => {
    scanResult.classList.remove('scan-result--visible');
  }, 6000);
}

/* ── Add entry to scan log ── */
function addLogEntry(token, success, message, mode = 'in') {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const shortToken = token.length > 20 ? token.slice(0, 10) + '…' + token.slice(-6) : token;
  const modeLabel = mode === 'out' ? '[OUT]' : mode === 'manual' ? '[MANUAL]' : '[IN]  ';

  history.unshift({ token, success, message, timeStr, mode });

  // Remove empty placeholder
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

  // Prepend so newest is on top
  scanLog.insertBefore(entry, scanLog.firstChild);

  // Keep log to last 20 entries
  const entries = scanLog.querySelectorAll('.log-entry');
  if (entries.length > 20) {
    entries[entries.length - 1].remove();
  }
}

/* ── Set button loading state ── */
function setLoading(btn, isLoading, defaultLabel) {
  btn.disabled = isLoading;
  btn.classList.toggle('btn-scan--loading', isLoading);
  const textEl = btn.querySelector('.btn-scan-text');
  textEl.textContent = isLoading ? 'กำลังตรวจสอบ...' : defaultLabel;
  // Disable ALL action buttons to prevent concurrent requests
  const others = [scanBtn, scanOutBtn, manualReleaseBtn].filter(b => b !== btn);
  others.forEach(b => { b.disabled = isLoading; });
}

/* ── Generic fetch helper ── */
async function doScan(apiUrl, token, btn, defaultLabel, mode) {
  setLoading(btn, true, defaultLabel);
  scanResult.classList.remove('scan-result--visible');

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_token: token }),
    });

    if (response.ok) {
      const data = await response.json();

      let successMsg;
      if (mode === 'in') {
        successMsg = '✅ เปิดไม้กั้นสำเร็จ! (Gate Opened)';
      } else {
        // scan-out: include freed slot_code from the response
        const slotCode = data.slot_code ?? '';
        successMsg = `✅ สแกนออกสำเร็จ! คืนพื้นที่ช่องจอด ${slotCode}`.trim();
      }

      showResult('success', successMsg);
      addLogEntry(token, true, successMsg.replace(/^✅ /, ''), mode);
      qrInput.value = '';
      clearBtn.style.opacity = '0';
      clearBtn.style.pointerEvents = 'none';
      qrInput.focus();

      // Visual flash feedback
      document.body.classList.add('gate-open');
      setTimeout(() => document.body.classList.remove('gate-open'), 800);

    } else {
      let detail = mode === 'in' ? 'รหัสไม่ถูกต้องหรือหมดอายุ' : 'ไม่พบข้อมูลการจอด หรือได้สแกนออกแล้ว';
      try {
        const errData = await response.json();
        if (errData.detail) detail = errData.detail;
      } catch (_) { /* ignore */ }

      const errorMsg = `❌ ${detail}`;
      showResult('error', errorMsg);
      addLogEntry(token, false, detail, mode);
      qrInput.select();
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
  const token = qrInput.value.trim();
  if (!token) {
    showResult('error', '⚠️ กรุณากรอก QR Token ก่อนกดสแกน');
    qrInput.focus();
    return;
  }
  await doScan(API_SCAN_IN, token, scanBtn, 'เปิดไม้กั้น (Scan In)', 'in');
}

/* ── Scan-Out ── */
async function performScanOut() {
  const token = qrInput.value.trim();
  if (!token) {
    showResult('error', '⚠️ กรุณากรอก QR Token ก่อนกดสแกนออก');
    qrInput.focus();
    return;
  }
  await doScan(API_SCAN_OUT, token, scanOutBtn, 'สแกนรถออก (Scan Out)', 'out');
}

/* ── Manual Release ── */
async function performManualRelease() {
  const slotCode = manualSlotInput.value.trim().toUpperCase();
  if (!slotCode) {
    showManualResult('error', '⚠️ กรุณากรอกรหัสช่องจอดก่อน');
    manualSlotInput.focus();
    return;
  }

  // Visual loading state
  manualReleaseBtn.disabled = true;
  manualReleaseBtn.classList.add('btn-manual-release--loading');
  const textEl = manualReleaseBtn.querySelector('.btn-manual-text');
  textEl.textContent = 'กำลังปลดล็อก...';
  [scanBtn, scanOutBtn].forEach(b => { b.disabled = true; });

  showManualResult('', ''); // hide previous

  try {
    const response = await fetch(API_MANUAL_RELEASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot_code: slotCode }),
    });

    if (response.ok) {
      const data = await response.json();
      const successMsg = `✅ ปลดล็อกช่องจอด ${data.slot_code} สำเร็จ`;
      showManualResult('success', successMsg);
      addLogEntry(slotCode, true, `ปลดล็อกช่อง ${data.slot_code} สำเร็จ`, 'manual');
      manualSlotInput.value = '';
      manualSlotInput.focus();
    } else {
      let detail = 'ไม่พบช่องจอด หรือไม่มีการจองที่ใช้งาน';
      try {
        const errData = await response.json();
        if (errData.detail) detail = errData.detail;
      } catch (_) { /* ignore */ }
      showManualResult('error', `❌ ${detail}`);
      addLogEntry(slotCode, false, detail, 'manual');
      manualSlotInput.select();
    }

  } catch (err) {
    showManualResult('error', '🔌 ไม่สามารถเชื่อมต่อ Server ได้ (Network Error)');
    addLogEntry(slotCode, false, 'Network Error', 'manual');
    console.error('[Admin/Manual] Network error:', err);
  } finally {
    manualReleaseBtn.disabled = false;
    manualReleaseBtn.classList.remove('btn-manual-release--loading');
    textEl.textContent = 'บังคับเคลียร์ช่องจอด';
    [scanBtn, scanOutBtn].forEach(b => { b.disabled = false; });
  }
}

/* ── Show result in the manual override result box ── */
function showManualResult(type, message) {
  manualResult.className = 'scan-result';
  if (!type && !message) return; // just reset
  manualResult.classList.add('scan-result--visible', `scan-result--${type}`);
  manualResult.textContent = message;

  clearTimeout(manualResult._hideTimer);
  manualResult._hideTimer = setTimeout(() => {
    manualResult.classList.remove('scan-result--visible');
  }, 6000);
}

/* ── Event listeners ── */

// Scan-in button click
scanBtn.addEventListener('click', performScanIn);

// Scan-out button click
scanOutBtn.addEventListener('click', performScanOut);

// Manual release button click
manualReleaseBtn.addEventListener('click', performManualRelease);

// Enter key on manual slot input
manualSlotInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    performManualRelease();
  }
});

// Enter key on QR input → Scan-In (primary action)
qrInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    performScanIn();
  }
});

// Clear input button
clearBtn.addEventListener('click', () => {
  qrInput.value = '';
  scanResult.classList.remove('scan-result--visible');
  clearBtn.style.opacity = '0';
  clearBtn.style.pointerEvents = 'none';
  qrInput.focus();
});

// Show/hide clear button based on input content
qrInput.addEventListener('input', () => {
  clearBtn.style.opacity = qrInput.value ? '1' : '0';
  clearBtn.style.pointerEvents = qrInput.value ? 'auto' : 'none';
});

// Clear log button
clearLogBtn.addEventListener('click', () => {
  scanLog.innerHTML = '<div class="log-empty">ยังไม่มีการสแกน</div>';
  history.length = 0;
});

/* ── Init ── */
window.addEventListener('DOMContentLoaded', () => {
  qrInput.focus();
  clearBtn.style.opacity = '0';
  clearBtn.style.pointerEvents = 'none';
});
