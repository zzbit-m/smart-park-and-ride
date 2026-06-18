# Smart Park & Ride

A parking reservation and check-in system for small managed park-and-ride facilities. Features slot booking, license-plate validation, OTP auth, and operator tools (QR scanning + analytics).

**Status:** MVP — functional for pilot, not production-hardened.

---

## Quick Start (PowerShell Automation — Recommended)

To launch the database, start the API backend, run migrations, and spin up a Cloudflare Tunnel automatically:
```powershell
.\start.ps1
```
*Note: The script automatically checks connection health, executes migrations inside the container, and copies the public tunnel URL to your clipboard!*

To cleanly stop the tunnel and tear down the containers:
```powershell
.\stop.ps1
```

---

## Alternative Manual Startup (Docker Compose)

### 1. Launch Services
```bash
docker-compose up --build -d
```
*   **API / Rider Portal:** `http://localhost:8000`
*   **Operator Dashboard:** `http://localhost:8000/admin.html`
*   **Layout Manager (React SPA):** `http://localhost:8000/admin-layout/`

### 2. Run Database Migrations
```bash
docker-compose exec backend alembic upgrade head
```

---

## Concurrency & Performance Testing

To verify the atomic Redis booking locks under heavy simultaneous user load, execute the load test script:
```bash
python C:\Users\Admin\.gemini\antigravity-ide\scratch\concurrency_test.py
```
This spawns 50 concurrent threads to attempt to book the exact same slot at the same millisecond, validating that the backend locks out double-bookings correctly.

---

## Default Credentials
| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `strong_internal_password_2026` / `admin123` |
| Operator | `operator` | `operator123` |


---

## Known Gaps (Pre-Production Checklist)

- [ ] **Real-time** — Frontend uses 30s polling; add SSE/WebSocket
- [ ] **Multi-device** — Booking tied to `localStorage`; migrate to server-side session
- [ ] **Error tracking** — Add Sentry
- [ ] **DB backup** — Add `pg_dump` cron + offsite storage
- [ ] **Tests** — Write frontend + integration tests
- [ ] **Thai plate** — Regex `[ก-ฮ]` strips vowels/tones
- [ ] **Offline** — No PWA; network drop breaks gate
- [ ] **Payment** — No billing integration
- [ ] **UI unification** — Admin split between vanilla dashboard and React layout tool

See [STATE.md](STATE.md) for full gap analysis.

---

## Documentation

| File | What it covers |
|------|----------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Backend architecture, state machine, limitations |
| [FEATURES.md](FEATURES.md) | Feature list by phase with known limits |
| [SETUP.md](SETUP.md) | Prerequisites, config, verification steps |
| [STATE.md](STATE.md) | Current state, gaps, and recommended work |
| [frontend/admin-layout/README.md](frontend/admin-layout/README.md) | Admin Layout Manager (React SPA) |
