# Smart Park & Ride — Project State Document

---

## 1. Project Overview & Goal

**Project:** Smart Park & Ride (ระบบจัดการที่จอดรถและรถรับส่ง)
**Platform:** Mobile Web App (PWA) — opened via browser, QR scan entry
**Core Goal:** Reduce time spent searching for parking, connect users to the Tram seamlessly, and collect data for resource management (Data-Driven Transit)

**User Journey:**
1. User opens web app, sees real-time slot map, taps an available slot
2. **License plate modal appears** — user enters their vehicle registration before booking is confirmed
3. Booking is created (15-min Redis countdown starts); user receives QR Code ticket showing slot + plate
4. On arrival: user shows QR Code at entry gate → slot status changes from "held" to "occupied"
5. After parking: app shows parked slot location + nearest Tram schedule
6. On exit: scan QR at exit gate → slot released back to "available"

**Key Business Rules:**
- Hold duration: 15 minutes (TTL enforced in Redis)
- Penalty system: 3 no-shows → 7-day booking ban per user
- Anomaly detection: flag slots that show "available" but have mismatched entry/exit timestamps

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | HTML + CSS + Vanilla JS | PWA, mobile-first, no build step |
| Backend | FastAPI (Python 3.11) | Async, handles concurrent slot contention |
| Primary DB | PostgreSQL 15 | History, bookings, users, tram schedules |
| Cache / Lock | Redis 7 | Real-time slot status, atomic Lua lock |
| Deployment | Docker + Docker Compose | All services containerized |

---

## 3. Completed Work

### Phase 1 — Database Schema (PostgreSQL + Redis Design) ✅

**PostgreSQL Tables:**
- `users` — id (UUID), phone, display_name, role (enum: user/admin/dispatcher), penalty_count, banned_until, created_at
- `parking_zones` — id, name, tram_stop, total_slots
- `parking_slots` — id, zone_id (FK), slot_code (e.g. "A-01"), last_known_status, updated_at
- `bookings` — id (UUID), user_id (FK), slot_id (FK), status (enum: held/confirmed/completed/expired/no_show), qr_token, **license_plate** (VARCHAR 20, nullable), held_at, expires_at, checked_in_at, checked_out_at, flagged
- `penalty_events` — id, user_id (FK), booking_id (FK), reason, created_at
- `trams` — id, tram_code, capacity, is_active
- `tram_schedules` — id, tram_id (FK), zone_id (FK), departure, arrival

**Indexes:**
- `idx_slots_zone` on parking_slots(zone_id)
- `idx_bookings_user`, `idx_bookings_slot`, `idx_bookings_status` on bookings
- `idx_bookings_expires` partial index on bookings(expires_at) WHERE status = 'held'
- `idx_tram_sched_zone` on tram_schedules(zone_id, departure)

**Redis Key Design:**
- Key: `slot:status:{slot_id}`
- Values: `"available"` | `"held:{booking_id}"` (TTL=900s) | `"occupied:{booking_id}"` (no TTL)
- Atomic hold via Lua script: SET only if current value is false or "available" — prevents race conditions

**Background Worker (design, not yet coded):**
- Runs every 60s via asyncio
- Queries bookings WHERE status='held' AND expires_at < now()
- Marks expired bookings as no_show, increments penalty_count, bans if >= 3, releases Redis key

---

### Phase 2 — FastAPI Backend + Slot Locking ✅

**Project entry point:** `backend/main.py`
- FastAPI app with CORS middleware (allow all origins — to be restricted in production)
- Lifespan handler: initializes Redis on startup, closes on shutdown
- Includes slots router, exposes `/health` endpoint

**Database connection:** `backend/database.py`
- Async SQLAlchemy engine using asyncpg driver
- `AsyncSessionLocal` session factory
- `get_db()` dependency for FastAPI injection
- DATABASE_URL from environment variable

**Redis client:** `backend/redis_client.py`
- Single shared `aioredis.Redis` client initialized at startup
- `hold_slot(slot_id, booking_id, ttl)` — runs atomic Lua script, returns bool
- `confirm_slot(slot_id, booking_id)` — sets occupied, removes TTL
- `release_slot(slot_id)` — sets back to available
- `get_slot_status(slot_id)` — single key fetch
- `get_all_slot_statuses(slot_ids)` — batch MGET for efficiency

**Slots router:** `backend/routers/slots.py`
- `GET /slots/` — fetches all slots from PostgreSQL, batch-fetches live status from Redis, returns merged list
- `POST /slots/{slot_id}/hold` — accepts JSON body `{ license_plate }`, validates plate, runs atomic Redis lock, writes booking (with `license_plate`) to PostgreSQL with expires_at = now + 15min. Returns 409 if slot already taken, 422 if plate missing/invalid.
- `DELETE /slots/{slot_id}/hold` — releases Redis key, marks booking as expired in PostgreSQL

**Docker Compose (`docker-compose.yml`):**
- Services: postgres, redis, backend
- Postgres mounts `db/schema.sql` into `/docker-entrypoint-initdb.d/` (auto-runs on first start)
- Backend mounts `./backend:/app` with `--reload` for live development
- Health checks on postgres and redis; backend depends_on both being healthy
- Postgres data persisted in named volume `postgres_data`

**Verified working:** `http://localhost:8000/docs` shows all 4 endpoints correctly ✅

---

### Phase 3 — Frontend PWA ✅

**Three files:** `frontend/index.html`, `frontend/style.css`, `frontend/app.js`

#### Screens (single-page, JS-controlled visibility)

| Screen ID | Purpose |
|---|---|
| `screen-home` | Main parking lot map |
| `screen-hold` | QR code + countdown after booking |
| `screen-parked` | Find my car + next tram |
| `screen-scanout` | Exit confirmation |
| `screen-tram` | Full tram schedule list |

#### Parking Lot Layout (screen-home)

- **Structure:** 2 columns × 10 rows = 20 slots total (A-01 to A-20)
- **Left column:** slots A-01 to A-10
- **Right column:** slots A-11 to A-20
- **Center:** a dashed vertical driving lane (`.lot-lane`) with a subtle dashed stripe pattern and a bidirectional arrow at row 5
- **Entry/Exit indicators:** "▼ ทางเข้า" above the grid, "▲ ทางออก" below
- **Slot card (`.lot-slot`):** icon (🅿/⏳/🚗) + slot code label, stacked vertically
- **Color states:**
  - Green (`available`): rgba(0,229,160) tones, clickable, hover scale + glow
  - Yellow (`held`): rgba(245,197,66) tones, not clickable
  - Red (`occupied`): rgba(255,77,109) tones, not clickable
- **Live status parsing:** raw Redis values like `"held:uuid"` and `"occupied:uuid"` are normalized to just `"held"` / `"occupied"` before rendering

#### Hold Screen

- Slot badge showing slot code
- QR code (visual placeholder — repeating-conic-gradient pattern with "P&R" center label + token substring)
- 15-minute live countdown (`DM Mono` font, large)
- Countdown bar that changes color: green→yellow (>50%), yellow→orange (>20%), red (<20%)
- Cancel booking button (danger style)

#### Parked Screen
- Shows saved parkedSlot code in large monospace font
- Map placeholder with pin emoji + zone/row/slot text
- Next tram widget showing random 3–12 min arrival (demo)
- Button to go to scan-out screen

#### Scan-Out Screen
- Calls `DELETE /slots/{slotId}/hold` API
- Shows success message, redirects to home after 1.8s

#### Tram Screen
- 5 hardcoded demo tram entries with route, zone, minutes until departure, and calculated HH:MM time
- Color-coded: green if ≤5 min, normal if 6–29 min, dimmed if ≥30 min

#### JS Architecture (`app.js`)

- `state` object: slots[], activeBooking, countdownTimer, modalCountdownTimer, parkedSlot
- `loadSlots()` → `renderParkingLot()` — full re-render on every refresh
- Slot click → `openPlateModal(slotId, slotCode)` — shows license plate input; on confirm calls `holdSlot(slotId, slotCode, plate)`
- `holdSlot(slotId, slotCode, licensePlate)` — POSTs JSON body `{ license_plate }` to API, saves booking + plate to localStorage, opens ticket modal
- `startCountdown()` — setInterval every 1s, clears itself on expiry
- `reopenTicketFromStorage()` — restores active booking (including license plate) from localStorage on page reload
- Auto-refresh: `setInterval(loadSlots, 30000)` every 30 seconds

#### Design System (`style.css`)

- **Theme:** Dark navy (`#0a0f1e` bg, `#111827` surface)
- **Fonts:** `Kanit` (Thai display), `DM Mono` (codes, numbers) — loaded from Google Fonts
- **Accent colors:** `#00e5a0` green, `#f5c542` yellow, `#ff4d6d` red, `#3d8bff` blue accent
- **Layout:** max-width 430px, centered, `height: 100vh` per screen, flex column
- **Bottom bar:** sticky, sits at bottom of each screen's flex flow
- **Toast notifications:** fixed, centered, fade in/out

---

### Phase 3b — Admin Portal with Login & Gate Scanner ✅

**Files:** `frontend/admin.html`, `frontend/admin.js`, `frontend/style.css`

#### Admin Authentication
- Login overlay (`#login-overlay`) shown until authenticated; hides on success
- `POST /api/admin/login` returns a Bearer token stored in `localStorage` under key `adminToken`
- `authHeaders()` helper attaches `Authorization: Bearer <token>` on every protected API call
- 401 responses from any endpoint auto-trigger `handle401()` → clears token, shows login overlay with session-expired message
- Logout clears token, resets form, returns to login overlay

#### Gate Scanner (Manual Token Input)
- `#qr-input` text field accepts pasted or USB-barcode-reader QR token
- **Scan In** button → `POST /api/slots/scan` (requires Bearer token)
- **Scan Out** button → `POST /api/slots/scan-out` (requires Bearer token)
- Enter key on input triggers Scan In for speed
- Clear button (`✕`) appears only when input has a value
- Result message animates in/out below the button row (success = green, error = red)

#### Admin Manual Override Card
- Separate card with amber accent border
- Slot code input → `POST /api/slots/manual-release` (requires Bearer token)
- Used when a driver exits without scanning out (forgotten checkout)
- Shows its own result banner independent of the scanner card

#### Recent Scans Log
- In-memory session log (max 20 entries, oldest auto-removed)
- Each entry shows: mode badge (`[IN]` / `[OUT]` / `[MANUAL]`), truncated token, success/error status, timestamp
- "ล้าง" button clears the in-page log

#### Backend Endpoints Used
| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/admin/login` | POST | None | Returns Bearer token |
| `/api/slots/scan` | POST | Bearer | Scan-In: mark slot occupied |
| `/api/slots/scan-out` | POST | Bearer | Scan-Out: mark booking completed |
| `/api/slots/manual-release` | POST | Bearer | Force-release slot by code |

---

### Phase 3c — Hardware/IoT Integration: Camera QR Scanner ✅

**Tested:** 2026-06-05 — E2E scan-in flow verified via webcam ✅

**Files changed:** `frontend/admin.html`, `frontend/admin.js`, `frontend/style.css`

#### Library
- `html5-qrcode@2.3.8` loaded via CDN (`unpkg.com`) — no build step required
- Uses the browser's native `getUserMedia` API (requires HTTPS or localhost; works over LAN via IP when page is served)

#### Camera Scanner UI Card (`.camera-card`)
- **Header row:** camera icon + title/subtitle + **▶ เปิดกล้อง** toggle button
- Toggle button turns green and shows **⏹ ปิดกล้อง** when camera is active
- `#qr-reader-wrap` (hidden by default) contains:
  - `#qr-reader` — `html5-qrcode` mounts the `<video>` feed here
  - `.camera-laser` — animated red laser sweep overlay (`@keyframes laserSweep`)
- On successful decode, scanning **pauses** and `#camera-decoded` panel appears with:
  - Truncated token preview
  - **Scan In** / **Scan Out** / **🔄 Rescan** action buttons
- Camera card flashes green on decode (`.camera-card--flash` keyframe)
- After Scan In or Scan Out action completes, camera stops automatically
- **Rescan** restarts the reader for the next ticket without reloading the page

#### JS Architecture (camera module in `admin.js`)
- `initCameraScanner()` — wires toggle + action buttons; called at end of `DOMContentLoaded`
- `startCamera()` — creates `Html5Qrcode` singleton, calls `.start({ facingMode: 'environment' }, ...)`, shows viewfinder + laser, updates button state
- `stopCamera()` — calls `.stop()` + `.clear()`, hides viewfinder, resets button state
- `resumeCamera()` — used by Rescan: stops then immediately restarts
- `onQrDecodeSuccess(decodedText)` — deduplicates rapid fires, pauses scanner, shows decoded panel, also populates `#qr-input` fallback (so Enter-to-scan also works)
- `handleCameraAction(mode)` — delegates to existing `doScan()` (which uses `authHeaders()`), then calls `stopCamera()`

#### CSS additions (end of `style.css`)
- `.camera-card`, `.camera-card-header`, `.camera-card-title-row` — layout
- `.btn-camera-toggle` (blue idle) + `.btn-camera-toggle--active` (green) — toggle button states
- `.camera-viewfinder` + `#qr-reader` overrides — strips the library's default border/background
- `.camera-laser` + `.camera-laser--active` + `@keyframes laserSweep` — animated sweep
- `.camera-decoded`, `.camera-decoded-inner`, `.camera-decoded-token` — decoded panel
- `.camera-action-row`, `.btn-cam-action`, `.btn-cam-rescan` — action row
- `.camera-card--flash` + `@keyframes cameraFlash` — green glow on decode

#### Real Device Testing (Mobile Hotspot)
- Both `app.js` and `admin.js` updated `API_BASE` to `http://172.20.10.2:8000` (laptop's hotspot IP)
- Phone accessed admin panel over Wi-Fi; webcam used as camera input during test
- Full Scan-In flow confirmed: QR decoded → Bearer token sent → backend marks slot `occupied` → success toast ✅


```
smart-park-and-ride/
├── project_state.md              ← this file
├── docker-compose.yml            ← spins up postgres + redis + backend
├── db/
│   ├── schema.sql                ← full PostgreSQL schema (all tables, enums, indexes)
│   └── migrations/
│       └── 001_add_license_plate.sql  ← ALTER TABLE bookings ADD COLUMN license_plate
├── backend/
│   ├── Dockerfile                ← python:3.11-slim, installs requirements
│   ├── requirements.txt          ← fastapi, uvicorn, asyncpg, sqlalchemy, aioredis
│   ├── main.py                   ← FastAPI app, CORS, lifespan, router includes
│   ├── database.py               ← async SQLAlchemy engine + get_db() dependency
│   ├── auto_seed.py              ← seeds parking slots on first start
│   ├── redis_client.py           ← Redis client, Lua lock script, slot helpers
│   └── routers/
│       ├── admin.py              ← POST /api/admin/login, verify_admin_token dependency
│       ├── slots.py              ← CRUD + scan-in/out + manual-release + analytics
│       └── trams.py              ← tram schedule endpoints
└── frontend/
    ├── index.html                ← User PWA: 5 screens + plate-modal + ticket-modal
    ├── app.js                    ← User state management, API calls, rendering
    ├── admin.html                ← Admin portal: login overlay + camera scanner + manual fallback + override + log
    ├── admin.js                  ← Admin auth, gate scanner logic, camera QR module (html5-qrcode)
    └── style.css                 ← Shared design system for both user PWA and admin portal
```

---

## 5. Upgrade Branch — Enterprise Features

### ✅ Completed

| Feature | Status | Files Changed |
|---|---|---|
| Vehicle Verification (License Plate Registration) | ✅ Done | `db/schema.sql`, `db/migrations/001_add_license_plate.sql`, `backend/routers/slots.py`, `frontend/index.html`, `frontend/app.js`, `frontend/style.css` |

#### Vehicle Verification — Implementation Detail

**Goal:** Prevent unauthorized external users from occupying slots by requiring a vehicle registration number before any booking is confirmed.

**How it works end-to-end:**

1. User taps an available (green) slot
2. `openPlateModal(slotId, slotCode)` is called — a premium modal pops up asking for ทะเบียนรถ
3. The "ยืนยันการจอง ✓" button stays **disabled** until the user types at least one character; ≥ 21 chars shows a red hint and keeps it disabled
4. On confirm (or Enter key), `holdSlot(slotId, slotCode, plate)` fires with `Content-Type: application/json` body `{ "license_plate": "PLATE" }`
5. Backend `HoldRequest` Pydantic model validates → strip + uppercase normalisation → `422` if empty or > 20 chars
6. `license_plate` is inserted into `bookings` alongside `qr_token` and `user_id`
7. Booking ticket modal shows a **ทะเบียนรถ** row so the user can verify their plate
8. Plate is also stored in `localStorage` with the booking so it survives page reload

**Database change:**
```sql
-- db/migrations/001_add_license_plate.sql
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20);
```
> For fresh containers, `schema.sql` already includes the column — no migration needed.

---

## 6. Pending Tasks / Exact Next Steps

### Phase 4 — Dashboard & Analytics Tab (Next)

1. **Live Slot Stats Dashboard** — add a second tab to `admin.html` showing:
   - Real-time slot counts (total / available / held / occupied) via `GET /api/slots/`
   - Auto-refresh every 10 s
   - Doughnut chart (Chart.js) showing slot distribution

2. **Peak Hours / Weekly Traffic Charts** — already implemented in `backend/routers/slots.py` as `GET /api/slots/analytics`; wire up bar charts in the admin dashboard tab

3. **Tram Dispatch Alerts** — show zones where occupied % exceeds threshold; trigger alert card

4. **Anomaly Detection Panel** — `SELECT * FROM bookings WHERE flagged = TRUE ORDER BY held_at DESC LIMIT 20`

### Phase 5 — Dockerization & Production Polish

- Add `frontend/` as a static file server (nginx container) to docker-compose
- Restrict CORS in `main.py` to only the frontend origin
- Add `.env` file for secrets (DB password, admin credentials)
- Replace placeholder `qr_token` (UUID) with signed JWT using `python-jose`
- Add `nginx.conf` for frontend serving + proxy pass to backend on `/api`
- Move `API_BASE` to a config file / env var so it doesn't need manual edits for device testing

### Known TODOs / Technical Debt

- ~~License plate not collected during booking~~ → **Fixed** ✅
- ~~Admin portal not built~~ → **Fixed** ✅
- ~~QR camera scanner for admin~~ → **Fixed & E2E tested** ✅
- `user_id` in `POST /slots/{id}/hold` is hardcoded to a placeholder UUID — real auth (phone-based login + JWT) not yet implemented
- QR code uses external `api.qrserver.com` — consider self-hosted `qrcode.js` for offline/LAN support
- Background worker (expiry sweep + penalty calculation) is designed but not yet coded
- `API_BASE` in `admin.js` and `app.js` currently hardcoded to `172.20.10.2:8000` (hotspot IP from device testing) — revert to `localhost:8000` before next local-only session
- `last_known_status` on `parking_slots` not updated on hold — only Redis holds live state; recovery path not yet implemented
