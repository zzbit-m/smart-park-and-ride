# Product Features

This document outlines the core capabilities of the Smart Park & Ride system, categorized by implementation phase.

---

## 🔒 Phase 0: Security & Configurations
- **In-Memory Secret Decoupling:** Enforces credential settings exclusively through shell environments. Default admin and operator users are defined securely at container build.
- **Runtime Web Endpoint Config:** Serves base URL values dynamically using `window.APP_CONFIG` initialized from static `config.js` files, simplifying localized static proxy deployments.
- **Strict CORS Profiles:** Blocks arbitrary network requests by targeting domain patterns provided in backend configuration parameters.
- **Seed Protection:** REST seed endpoints are disabled for standard access and protected by mandatory Admin credentials.

---

## ⚙️ Phase 1: Stability & Fault Tolerance
- **Transient-Persistent Hold Reconciler:** A dedicated backend worker identifies unconfirmed slot holds in PostgreSQL whose Redis session TTLs have elapsed, updating their records to `EXPIRED` to prevent stuck resources.
- **Unified Logging Standard:** Captures crucial occurrences (user logins, reservations, gate checking, and scanner activity) using uniform, structured output formats.
- **Exception Shielding:** Intercepts runtime application errors, formatting them into predictable error schemas without leaking sensitive internal trackbacks.
- **Operational Health Resource:** Surfaces DB and Cache connections at `/health` to verify runtime health check status.

---

## 🏛️ Phase 2: Domain Architecture Design
- **Domain Service Isolation:** Extracted all booking logic into `slot_service.py` to keep endpoints clean, simple, and declarative.
- **Lifecycle Machine Invariants:** Blocks out-of-order state modifications (e.g., active bookings cannot be reverted to holds).
- **Consolidated Startup Parser:** Merges environment configuration parsing into a single file (`backend/config.py`) to confirm critical settings are resolved before boot.

---

## 🔑 Phase 3: Identity, System Limits, & Audit Trail
- **Signed JWT Sessions:** Generates secure HS256 JWT tokens containing role, username, and expiration credentials.
- **Role-Based API Access:** Gated actions where Operator keys are restricted from performing administrative actions (e.g., changing DB configuration parameters).
- **Endpoint Protection Rate Limits:** Employs atomic Redis key counters to mitigate denial-of-service attempts or concurrent script-based reservations on critical paths.
- **Audit Logging Logs:** Logs structural database transactions with timestamped trails identifying the active user account.

---

## 🖥️ Phase 4: Operator & Rider Experience
- **Analytics KPIs Panels:** Renders real-time statistics (occupancy counts, average check-in times, expired session trends) inside the administrator interface.
- **Camera-Based Gate Scanner:** Employs front-facing camera feeds to scan and decode client-side ticket QR codes, executing check-in/check-out flows dynamically.
- **Vehicle Identifier Capture:** Associates vehicle plate configurations with slots during initial holds.
- **Client-Side QR Rendering:** Embeds `qrious.min.js` to draw booking validation credentials locally, keeping the check-in queue active even without external internet access.

---

## 🚀 Phase 5: Production Deployment & Hardening
- **Containerized Optimization:** Secure multi-stage base image targets running under non-root user `appuser`.
- **Pipeline Build & Lint Gating:** Automated GitHub Actions CI workflow to run tests on every pull request.
- **Connection Health Checks:** Configured urllib-based health checks in container environments to verify service dependencies.
- **Decoupled Background Worker:** Standalone python process container separating expiry loops from the main API process.
- **Production Server Supervising:** FastAPI application running with Gunicorn master process overseeing 4 Uvicorn workers.
- **Database Migrations:** Structured DB versioning with Alembic, enabling baseline migrations and clean schemas.
- **Quality Assurance Testing:** Unit test suite covering JWT authentication and booking state machine flows.

---

## 🚘 Phase 6: Passenger Identity & Vehicle Registry
- **Passwordless OTP Authentication:** Commuters verify identity via SMS OTP without standard passwords.
- **Commuter JWT Sessions:** Commuters receive signed JWT sessions, cached locally in the browser.
- **Saved Vehicle Registry:** Automatically persists plate numbers and provinces to a `user_vehicles` database.
- **One-Click Bookings:** Automatically reads saved vehicles on modal open to allow instant, typo-free holds.


