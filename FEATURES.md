# Product Features

Core capabilities of the Smart Park & Ride system, grouped by phase.

---

## 🔒 Phase 0: Security & Configurations
- **In-Memory Secret Decoupling:** Credentials from environment only. No hardcoded secrets.
- **Runtime Web Endpoint Config:** `window.APP_CONFIG` from static `config.js` for flexible deployment.
- **Strict CORS Profiles:** Domain whitelist enforced at middleware level.
- **Seed Protection:** Admin-only seeding endpoint.

---

## ⚙️ Phase 1: Stability & Fault Tolerance
- **Transient-Persistent Hold Reconciler:** Background worker expires stale Redis holds in PostgreSQL.
- **Unified Logging:** Structured logs for key events.
- **Exception Shielding:** No internal traceback leakage.
- **Health Endpoint:** `/health` checks DB + Redis.

---

## 🏛️ Phase 2: Domain Architecture Design
- **Domain Service Isolation:** Booking logic in `slot_service.py`.
- **Lifecycle State Machine:** Blocks invalid transitions.
- **Centralized Config:** Single `backend/config.py`.

---

## 🔑 Phase 3: Identity, System Limits, & Audit Trail
- **Signed JWT Sessions:** HS256 tokens with role + expiry.
- **Role-Based API Access:** Operator vs Admin gating.
- **Rate Limiting:** Redis atomic counters per user.
- **Audit Logging:** Timestamped trails for DB mutations.

---

## 🖥️ Phase 4: Operator & Rider Experience
- **Analytics Dashboard:** Occupancy, average check-in time, expired trends.
- **Camera QR Scanner:** Client-side webcam scan for check-in/check-out.
- **License Plate Capture:** Plate + province + vehicle type (car/motorcycle) associated with each hold.
- **Client-Side QR Rendering:** Offline-capable via `qrious.min.js`.

---

## 🚀 Phase 5: Production Hardening & CI/CD
- **Multi-stage Docker:** Non-root `appuser`, optimized layers.
- **Gunicorn + Uvicorn:** 4 workers behind master process.
- **Alembic Migrations:** Versioned schema changes.
- **GitHub Actions:** Lint + test on every PR.
- **Decoupled Expiry Worker:** Standalone container process.

---

## 🚘 Phase 6: Passenger Identity & Vehicle Registry
- **Passwordless OTP Auth:** Phone-based SMS verification (Twilio integration via `services/sms.py`).
- **Twilio SMS Sending:** Production SMS via `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`; falls back to debug mode (`DEBUG_OTP=true`) logging OTP to console.
- **Commuter JWT:** Token cached in `localStorage`.
- **Saved Vehicle Registry:** Auto-saves plate + province + vehicle type (car/motorcycle) to `user_vehicles`.
- **One-Click Bookings:** Saved vehicles load instantly on modal open.
- **Vehicle Deletion UI:** Delete saved plates from the booking modal.
- **No-Show Penalty:** 3 strikes → 24-hour ban.
- **Slot-Hoarding Prevention:** Same plate cannot hold multiple slots.

---

## 💬 Phase 7: User Feedback System
- **Submit Feedback:** `POST /api/feedback/` — accepts bug, feature, general requests (rate-limited, 10/min).
- **Admin Review Panel:** `GET /api/feedback/` with `?status=`, `?type=`, pagination (`?limit=`, `?offset=`).
- **Status Management:** `PATCH /api/feedback/{id}` — update status: open → reviewed → closed (404 on missing).
- **Validation:** Message 1–2000 chars, type restricted to `bug` / `feature` / `general`, optional email.
- **Self-Service UI:** `frontend/feedback.html` — user-facing form with live char counter, spinner loading, success/error feedback.
- **Admin UI:** `frontend/feedback-admin.html` — filterable table with inline status updates (uses admin JWT from login).
- **Persistence:** Bind mount `./backend/backups:/app/backups` survives container restarts.

---

## 📊 Phase 8: Analytics & Business Insights
- **Admin Export Summary:** `GET /api/admin/export/summary` — aggregated daily/weekly/monthly insights with car vs motorcycle breakdown.
- **SQL Aggregation:** Uses `GROUP BY` and `BETWEEN` for efficient time-range queries (no Python loops).
- **Three-Layer Separation:** Repository (SQL) → Service (logic) → Router (endpoint) for clean maintainability.
- **Day / Week / Month Ranges:** Date picker + range selector in the admin Dashboard card.
- **Downloadable JSON:** One-click download of aggregated summary as a formatted JSON file.
- **Occupancy Rate:** `unique_slots_used / total_slots` derived from `parking_zones.total_slots`.
- **Peak Hour Detection:** Derives busiest hour from hourly distribution in a single pass.
- **Slot Utilization Ranking:** `slot_code` + `usage_count` sorted descending.

---

## 🏗️ Phase 9: Layout Management & Admin Tooling
- **Dynamic Layout System:** `parking_layouts` + `parking_layout_slots` tables with versioned JSONB config.
- **Layout Sync Service:** `services/layout_sync.py` — `apply_layout()` validates config and applies in one transaction.
- **Diff Preview:** `POST /api/admin/layout/diff` — read-only preview of what a layout would change.
- **Layout Upload:** `POST /api/admin/layout/upload` — atomically apply a layout (422 on validation/conflict).
- **Layout Query:** `GET /api/admin/layout/current` — returns active layout or null.
- **Alembic Migration:** `f6a7b8c9d0e1_add_dynamic_layout_tables.py` — adds tables, indexes, constraints.
- **React Admin-Layout SPA:** Staff-only tool at `/admin-layout/` (Vite + React 18) for visual layout editing with grid preview.
- **Tab Redirect:** `admin.js` Layout tab redirects to the React SPA.
- **Grid Preview Logic:** Matches backend `_generate_slot_code` shorthand logic (1×≤10 → no row prefix).
- **Field Proportions:** Balanced zone-row form fields (name flex:2, rows/cols 60px, prefix 64px, type flex:1.2).
- **Slot Type Normalization:** Lowercase `slot_type` enforced at sync layer + DB CHECK constraint.
- **App Config Injection:** `window.APP_CONFIG` served via backend static route at `/admin-layout/config.js`.

---

### ⚠️ Known Limitations

| Area | Limitation |
|------|-----------|
| **Real-time** | Frontend uses 30s polling, not WebSocket/SSE |
| **Session** | Booking tied to `localStorage` (1 device) |
| **Testing** | 4 test files, zero frontend tests |
| **Monitoring** | No Sentry, no uptime monitoring |
| **Backup** | Manual via `python backup.py` (pg_dump installed in container) |
| **UI framework** | Vanilla JS + React SPA for layout tool — unification incomplete |
| **Thai plate** | Regex strips vowels/tones (e.g., เพ, แก) |
| **Payment** | No billing or receipt system |
| **Multi-zone** | Single parking lot only |
| **Offline** | No PWA; network drop breaks gate flow |
| **Admin split** | Dashboard in vanilla JS, layout tool in React — two UIs to maintain |
