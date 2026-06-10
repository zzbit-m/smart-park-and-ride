# Current System State

Single source of truth tracking implementation progress, health, and remaining work.

---

## Overall Health Status
- **Current Milestone:** MVP — functional for small-scale pilot
- **Stability Rating:** Stable core booking flow, but several gaps for production
- **Backend Health:** Core layers are decoupled; business logic resides cleanly within services. State machine invariants enforced. No error tracking (Sentry).
- **Frontend Health:** Functional vanilla JS. Booking tied to `localStorage` (1 device). No real-time updates (30s polling).

---

## Feature Progress Checklist

### ✅ Completed Work

#### Phase 0: Security & Configurations
- [x] Enforce environment variable security constraints
- [x] Runtime web client configuration via `config.js`
- [x] Explicit domain restrictions (CORS origin validation)
- [x] Protected database seeding behind admin validation

#### Phase 1: Stability Layer
- [x] Background async expiry worker to sync Redis holds with PostgreSQL
- [x] Uniform, structured logs configuration
- [x] Exception shielding to prevent runtime leak of tracebacks
- [x] Connection health endpoint at `/health`

#### Phase 2: Architecture Design
- [x] Extract slot reservation logic into dedicated service handlers
- [x] Lock state updates inside a validated transition matrix
- [x] Unify startup parameters under a central config file

#### Phase 3: Identity & Limits
- [x] Access token validation using HS256-signed JWTs
- [x] Role check validation on sensitive operations
- [x] Cache-backed transaction rate limiting
- [x] Audit trail recording on structural database changes

#### Phase 4: Operator & Rider Experience
- [x] Operations dashboard with live charts and metrics
- [x] Integrated HTML5 webcam-based QR ticket scanner
- [x] Capture vehicle license plate during hold transactions
- [x] Client-side ticket QR generation via `qrious.min.js`

#### Phase 5: Production Hardening & CI/CD
- [x] Secure multi-stage, non-root Docker builds
- [x] Gunicorn/Uvicorn multi-process servers
- [x] GitHub Actions CI workflow (lint + tests on PR)
- [x] Alembic migration framework with baseline schema
- [x] Decoupled expiry worker in standalone container
- [x] Backend container health checks in docker-compose.yml

#### Phase 6: Passenger Identity & Vehicle Registry
- [x] Database migration and `user_vehicles` table
- [x] Passwordless OTP request and validation endpoints
- [x] Front-end OTP verification dialog
- [x] Browser token + vehicle caching for one-click bookings
- [x] Saved vehicle list with delete controls
- [x] Thai license plate regex validation (frontend + backend)
- [x] Slot-hoarding prevention (duplicate plate check)
- [x] No-show penalty engine (3 strikes → 24h ban)

#### Phase 7: Testing & Quality Assurance
- [x] test harness with pytest, pytest-asyncio, httpx
- [x] Unit tests for JWT helpers and state-machine transitions
- [x] Async SQL tests for auth and registry flows

#### Phase 8: System Stabilization & Hardening (Incremental Fixes)
- [x] Fixed out-of-the-box DB connection password fallbacks preventing InvalidPasswordError
- [x] Fixed containerized Redis connectivity to use bridge hostname routing
- [x] Exposed missing environment variables inside backend containers
- [x] Fixed worker NameError crash caused by missing timedelta import
- [x] Secured application boot by preventing auto-seeding errors from crash-looping FastAPI
- [x] Dynamically resolved API origin configurations on the frontend
- [x] Mounted runtime configurations in frontend feedback portals
- [x] Aligned compose service command with Dockerfile Gunicorn worker supervisor
- [x] Created DEBUG_OTP config to mask OTP generation values in production payloads
- [x] Hardened environment configurations (POSTGRES_USER, POSTGRES_DB, ADMIN_PASSWORD, OPERATOR_PASSWORD in .env) to prevent fallback warnings
- [x] Secured JWT signatures with a cryptographically secure 64-character random key
- [x] Removed public ngrok tunnel from CORS Allowed Origins to restrict traffic to local environment hosts
- [x] Ignored untracked client configurations and python build cache artifacts in Git
- [x] Verified clean startup and health checks for database, redis, backend, and background worker containers

---

### ⚠️ Known Gaps & Limitations

#### Core Booking
- [ ] **No real-time updates** — Frontend polls every 30s; use SSE or WebSocket for live slot status
- [ ] **Single-device session** — Booking stored in `localStorage`; user cannot switch devices mid-booking
- [ ] **No waitlist** — If all slots held, user gets no queue position

#### Monitoring & Operations
- [ ] **No error tracking** — No Sentry or equivalent for production error monitoring
- [ ] **No DB backup** — No automated backup/restore script for PostgreSQL
- [ ] **No uptime monitoring** — No external health check pings

#### Testing
- [ ] **No frontend tests** — Zero coverage on UI logic
- [ ] **No integration tests** — No end-to-end flow tests (hold → scan-in → scan-out)

#### Frontend UX
- [ ] **Vanilla JS maintenance burden** — No framework; scales poorly with complexity
- [ ] **Thai plate regex strips vowels/tones** — `[ก-ฮ]` range excludes vowels and tone marks
- [ ] **Confirm dialog blocks UI** — Uses `confirm()` for delete; no custom modal

#### Business Features
- [ ] **No payment integration** — No billing or receipt system
- [ ] **No multi-zone/floor support** — Single lot only
- [ ] **No email/SMS confirmation** — No booking receipt delivery

---

### 📅 Recommended Work (for small-production use)

1. **DB Backup** — Add `pg_dump` cron to docker-compose with S3 upload
2. **Error Tracking** — Add Sentry (1-line config for FastAPI)
3. **Real-time** — Replace polling with Server-Sent Events for live slot updates
4. **Server-side session** — Replace `localStorage` with token stored in httpOnly cookie for multi-device support
5. **Integration tests** — Cover hold → cancel, hold → scan-in → scan-out
6. **PWA manifest** — Add offline support so gate works during network drops
7. **Payment** — Add Stripe/PromptPay for paid parking

**Status:** READY FOR INTERNAL COMPANY USE ✅ (Production Hardening and configuration gaps resolved)
