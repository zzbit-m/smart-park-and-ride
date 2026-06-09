# Smart Park & Ride

A parking reservation and check-in system for small managed park-and-ride facilities. Features slot booking, license-plate validation, OTP auth, and operator tools (QR scanning + analytics).

**Status:** MVP — functional for pilot, not production-hardened.

---

## Quick Start

### 1. Launch Services
```bash
docker-compose up --build
```
- **API:** `http://localhost:8000`

### 2. Launch Frontend
```bash
cd frontend
python -m http.server 5500
```
- **Rider Portal:** `http://localhost:5500/index.html`
- **Operator Dashboard:** `http://localhost:5500/admin.html`
- **Feedback Form:** `http://localhost:5500/feedback.html`
- **Feedback Admin:** `http://localhost:5500/feedback-admin.html`

### 3. Default Credentials
| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `password123` |
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

See [STATE.md](STATE.md) for full gap analysis.

---

## Documentation

| File | What it covers |
|------|----------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Backend architecture, state machine, limitations |
| [FEATURES.md](FEATURES.md) | Feature list by phase with known limits |
| [SETUP.md](SETUP.md) | Prerequisites, config, verification steps |
| [STATE.md](STATE.md) | Current state, gaps, and recommended work |
