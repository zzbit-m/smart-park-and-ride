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

## 📊 Phase 7: Analytics & Business Insights
- **Admin Export Summary:** `GET /api/admin/export/summary` — aggregated daily/weekly/monthly insights with car vs motorcycle breakdown.
- **SQL Aggregation:** Uses `GROUP BY` and `BETWEEN` for efficient time-range queries (no Python loops).
- **Three-Layer Separation:** Repository (SQL) → Service (logic) → Router (endpoint) for clean maintainability.
- **Day / Week / Month Ranges:** Date picker + range selector in the admin Dashboard card.
- **Downloadable JSON:** One-click download of aggregated summary as a formatted JSON file.
- **Occupancy Rate:** `unique_slots_used / total_slots` derived from `parking_zones.total_slots`.
- **Peak Hour Detection:** Derives busiest hour from hourly distribution in a single pass.
- **Slot Utilization Ranking:** `slot_code` + `usage_count` sorted descending.

---

## 💬 Phase 6: User Feedback System
- **Submit Feedback:** `POST /api/feedback/` — accepts bug, feature, general requests (rate-limited, 10/min).
- **Admin Review Panel:** `GET /api/feedback/` with `?status=`, `?type=`, pagination (`?limit=`, `?offset=`).
- **Status Management:** `PATCH /api/feedback/{id}` — update status: open → reviewed → closed (404 on missing).
- **Validation:** Message 1–2000 chars, type restricted to `bug` / `feature` / `general`, optional email.
- **Self-Service UI:** `frontend/feedback.html` — user-facing form with live char counter, spinner loading, success/error feedback.
- **Admin UI:** `frontend/feedback-admin.html` — filterable table with inline status updates (uses admin JWT from login).
- **Persistence:** Bind mount `./backend/backups:/app/backups` survives container restarts.

---

## 🚘 Phase 7: Passenger Identity & Vehicle Registry
- **Passwordless OTP Auth:** Phone-based SMS verification.
- **Commuter JWT:** Token cached in `localStorage`.
- **Saved Vehicle Registry:** Auto-saves plate + province + vehicle type (car/motorcycle) to `user_vehicles`.
- **One-Click Bookings:** Saved vehicles load instantly on modal open.
- **Vehicle Deletion UI:** Delete saved plates from the booking modal.
- **No-Show Penalty:** 3 strikes → 24-hour ban.
- **Slot-Hoarding Prevention:** Same plate cannot hold multiple slots.

---

### ⚠️ Known Limitations

| Area | Limitation |
|------|-----------|
| **Real-time** | Frontend uses 30s polling, not WebSocket/SSE |
| **Session** | Booking tied to `localStorage` (1 device) |
| **Testing** | 4 test files, zero frontend tests |
| **Monitoring** | No Sentry, no uptime monitoring |
| **Backup** | Manual via `python backup.py` (pg_dump installed in container) |
| **UI framework** | Vanilla JS — maintenance scales poorly |
| **Thai plate** | Regex strips vowels/tones (e.g., เพ, แก) |
| **Payment** | No billing or receipt system |
| **Multi-zone** | Single parking lot only |
| **Offline** | No PWA; network drop breaks gate flow |
