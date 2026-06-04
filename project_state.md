# Smart Park & Ride — Project State Document

---

## 1. Project Overview & Goal

**Project:** Smart Park & Ride (ระบบจัดการที่จอดรถและรถรับส่ง)
**Platform:** Mobile Web App (PWA) — opened via browser, QR scan entry
**Core Goal:** Reduce time spent searching for parking, connect users to the Tram seamlessly, and collect data for resource management (Data-Driven Transit)

**User Journey:**
1. User opens web app, sees real-time slot map, taps a slot to hold it (15 min timer starts)
2. On arrival: user shows QR Code at entry gate → slot status changes from "held" to "occupied"
3. After parking: app shows parked slot location + nearest Tram schedule
4. On exit: scan QR at exit gate → slot released back to "available"

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
- `bookings` — id (UUID), user_id (FK), slot_id (FK), status (enum: held/confirmed/completed/expired/no_show), qr_token, held_at, expires_at, checked_in_at, checked_out_at, flagged
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
- `POST /slots/{slot_id}/hold` — verifies slot exists, generates booking_id + qr_token (UUID placeholder, JWT in Phase 3), runs atomic Redis lock, writes booking to PostgreSQL with expires_at = now + 15min. Returns 409 if slot already taken.
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

- `USE_DEMO` flag: `window.location.protocol === 'file:'` — auto-activates when opened as a local file, bypassing all API calls (avoids CORS block)
- `state` object: slots[], activeBooking, countdownTimer, parkedSlot
- `loadSlots()` → `renderParkingLot()` — full re-render on every refresh
- `holdSlot()` — in demo mode, mutates state.slots directly and re-renders without API call
- `startCountdown()` — setInterval every 1s, clears itself on expiry
- Auto-refresh: `setInterval(loadSlots, 30000)` every 30 seconds

#### Design System (`style.css`)

- **Theme:** Dark navy (`#0a0f1e` bg, `#111827` surface)
- **Fonts:** `Kanit` (Thai display), `DM Mono` (codes, numbers) — loaded from Google Fonts
- **Accent colors:** `#00e5a0` green, `#f5c542` yellow, `#ff4d6d` red, `#3d8bff` blue accent
- **Layout:** max-width 430px, centered, `height: 100vh` per screen, flex column
- **Bottom bar:** sticky, sits at bottom of each screen's flex flow
- **Toast notifications:** fixed, centered, fade in/out

---

## 4. Current File Structure

```
parking/
├── project_state.md              ← this file
├── docker-compose.yml            ← spins up postgres + redis + backend
├── db/
│   └── schema.sql                ← full PostgreSQL schema (all tables, enums, indexes)
├── backend/
│   ├── Dockerfile                ← python:3.11-slim, installs requirements
│   ├── requirements.txt          ← fastapi, uvicorn, asyncpg, sqlalchemy, redis, python-jose
│   ├── main.py                   ← FastAPI app, CORS, lifespan, router include
│   ├── database.py               ← async SQLAlchemy engine + get_db() dependency
│   ├── redis_client.py           ← Redis client, Lua lock script, slot helpers
│   └── routers/
│       └── slots.py              ← GET /slots/, POST /slots/{id}/hold, DELETE /slots/{id}/hold
└── frontend/
    ├── index.html                ← 5 screens, all markup
    ├── style.css                 ← full design system, parking lot styles
    └── app.js                    ← state management, API calls, demo mode, rendering
```

---

## 5. Pending Tasks / Exact Next Steps

### Phase 4 — Admin Dashboard & Tram Analytics

**File to create:** `frontend/admin.html` (separate page, not part of user PWA)

**Features to build:**

1. **Live Operations Dashboard**
   - Full parking lot grid (same layout as user view, read-only)
   - Real-time slot counts: total / available / held / occupied
   - Auto-refresh every 10s via polling or WebSocket

2. **Peak Hours Chart**
   - Bar chart of booking density by hour of day (0–23)
   - Data source: `SELECT EXTRACT(HOUR FROM held_at), COUNT(*) FROM bookings GROUP BY 1`
   - Recommend: use Chart.js (CDN, no install) for rendering

3. **Tram Dispatch Alerts**
   - Show zones where occupied count exceeds threshold (e.g. >80% full)
   - Trigger visual alert card: "ส่งรถไปโซน A — คนเยอะ"

4. **Anomaly Detection Panel**
   - Query: `SELECT * FROM bookings WHERE flagged = TRUE ORDER BY held_at DESC LIMIT 20`
   - Display as a table with slot_code, user_id, held_at, checked_in_at, checked_out_at

5. **Backend endpoints needed (add to `routers/admin.py`):**
   - `GET /admin/stats` — returns counts per status
   - `GET /admin/peak-hours` — returns hourly booking counts
   - `GET /admin/anomalies` — returns flagged bookings

### Phase 5 — Dockerization Polish

- Add `frontend/` as a static file server (nginx container) to docker-compose
- Restrict CORS in `main.py` to only the frontend origin
- Add `.env` file for secrets (DB password, JWT secret key)
- Replace placeholder `qr_token` (UUID) with signed JWT using `python-jose`
- Add placeholder user (`00000000-0000-0000-0000-000000000001`) seed in `schema.sql`
- Add `nginx.conf` for frontend serving + proxy pass to backend on `/api`

### Known TODOs / Technical Debt

- `user_id` in `POST /slots/{id}/hold` is hardcoded to a placeholder UUID — real auth (phone-based login + JWT) not yet implemented
- QR code is a visual placeholder — needs real QR generation (use `qrcode.js` CDN on frontend)
- Background worker (expiry sweep + penalty calculation) is designed but not yet coded — needs to be added to `main.py` as an asyncio background task
- `parking_slots` table is empty — needs seed data (INSERT 20 slots into zone 1)
- `last_known_status` on `parking_slots` is not being updated on hold/release — only Redis holds live state; recovery path not yet implemented
