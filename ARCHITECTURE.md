# System Architecture

This document details the architectural layout, core design patterns, and system invariants of the Smart Park & Ride application.

---

## Core Architecture Principles

### 1. Data Source Roles
* **PostgreSQL (Persistent Storage):** Canonical source of truth for long-term records including confirmed bookings, slot mappings, operator users, and audit logs.
* **Redis (Transient Storage & Locking):** Strictly used to cache temporary session holds (TTL-based), track rate limiting counters, and manage lock acquisitions to prevent double booking slots.

### 2. Layer Separation
* **Routers (Presentation):** FastAPI routers are thin, descriptive, and declarative. Their duties are limited to validating request bodies, handling HTTP exception wrapping, and mapping response schemas.
* **Services (Business Logic):** Realized in `backend/services/slot_service.py`, this layer acts as the single entry point for slot booking and modification, enforcing state machine invariants.
* **Database (Persistence):** SQL scripts and ORM commands managing standard transaction scopes.

---

## Booking Lifecycle State Machine

A reservation transitions through strict phases to maintain data consistency.

```mermaid
stateDiagram-v2
    [*] --> HELD : Initiate Booking
    HELD --> CONFIRMED : Confirm Reservation (Provide Plate)
    HELD --> EXPIRED : TTL Expires (Redis Sync)
    CONFIRMED --> ACTIVE : Scan-In (On-site entry)
    ACTIVE --> COMPLETED : Scan-Out (On-site exit)
```

### State Definitions
1. **HELD:** A temporary hold placed on a parking slot. Backed by a Redis key with a short-lived Time-To-Live (TTL) of 5 minutes.
2. **CONFIRMED:** The reservation is secured once the customer supplies vehicle plate information.
3. **ACTIVE:** The vehicle has checked in at the parking facility barrier.
4. **COMPLETED:** The vehicle has checked out and departed the facility.
5. **EXPIRED:** A held reservation that did not receive confirmation before its TTL expired.

### Consistency Worker
* A standalone, decoupled background worker process (`expiry_worker.py`) running as a separate container service polls and reconciles state inconsistencies. It identifies PostgreSQL records stuck in `HELD` that have expired in Redis, updating their status to `EXPIRED`.


---

## Security & Authentication

* **No Hardcoded Credentials:** The application parses database, cache, CORS settings, and default logins from environment variables initialized inside `backend/config.py`.
* **HS256 JWT Authorization:** Administrators and Operators acquire signed JSON Web Tokens during login to access secure API routes.
* **Role-Based Access Control (RBAC):** Privileges are checked before execution. Administrators can override, export data, and modify slot counts; Operators are limited to scanning operations and manual overrides.
* **CORS Settings:** A strict CORS middleware matches client origins against variables dynamically supplied at runtime.

---

## Frontend Delivery Configuration
* **Environment Agnosticism:** To bypass heavy build-time configurations, the static Vanilla HTML/JS frontend queries backend URLs using `window.APP_CONFIG` initialized from `frontend/config.js` at runtime.
