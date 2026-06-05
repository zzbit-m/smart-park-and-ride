# Smart Park & Ride — Engineering Roadmap

## Overview

This document defines a **phased implementation and stabilization plan** for the Smart Park & Ride system.

The goal is to:

* Safely move from MVP → Production
* Reduce technical risk
* Enable incremental improvements without breaking the system
* Make the project AI-agent-friendly for autonomous iteration

---

# Phase 0 — Critical Fixes (Pre-Deployment)

**Goal:** Prevent security risks and broken deployments
**Time:** ~2–3 hours
**Priority:** 🔴 CRITICAL

## Tasks

### 0.1 Secure Admin Credentials

* Remove default fallback values:

```python
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
```

* Add startup validation:

```python
if not ADMIN_USERNAME or not ADMIN_PASSWORD:
    raise RuntimeError("Admin credentials must be set via environment variables")
```

---

### 0.2 Fix Frontend API Configuration

* Replace hardcoded IP with environment-based config

**Before:**

```js
const API_BASE = "http://172.20.10.2:8000";
```

**After:**

```js
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
```

---

### 0.3 Restrict CORS

**Before:**

```python
allow_origins=["*"]
```

**After:**

```python
allow_origins=[
    "http://localhost:5173",
    "https://yourdomain.com"
]
```

---

### 0.4 Protect Seed Endpoint

```python
@router.post("/seed")
def seed(..., user=Depends(verify_admin_token)):
```

---

## Exit Criteria

* No hardcoded secrets
* App runs correctly on any machine
* Unauthorized users cannot access admin or seed endpoints

---

# Phase 1 — Stability Layer

**Goal:** Prevent data inconsistencies and silent failures
**Time:** 1–2 days
**Priority:** 🔴 HIGH

## Tasks

### 1.1 Background Expiry Worker

Problem:

* Redis expires holds
* PostgreSQL does NOT update → inconsistent state

Solution:

* Add async background task (runs every 60s)

Responsibilities:

* Find expired bookings
* Update status → `EXPIRED`
* Apply penalties if needed

---

### 1.2 Logging System

* Add structured logging

Minimum:

```python
import logging
logging.basicConfig(level=logging.INFO)
```

Better:

* Log all critical flows:

  * booking created
  * scan-in
  * scan-out
  * manual release
  * errors

---

### 1.3 Environment Configuration File

Create `.env.example`:

```
ADMIN_USERNAME=
ADMIN_PASSWORD=
DATABASE_URL=
REDIS_URL=
API_BASE=
```

---

### 1.4 Global Error Handling

* Add middleware for consistent error responses
* Avoid leaking stack traces

---

## Exit Criteria

* System recovers from expired holds correctly
* Logs exist for debugging
* New developer can run system using `.env`

---

# Phase 2 — Architecture Refactor

**Goal:** Improve maintainability and scalability
**Time:** 3–5 days
**Priority:** 🟡 MEDIUM

## Tasks

### 2.1 Introduce Service Layer

Refactor structure:

```
app/
  api/
  services/
  repositories/
  models/
  core/
```

* Move business logic out of routes
* Routes should only:

  * validate input
  * call services
  * return response

---

### 2.2 Booking State Machine

Define strict state transitions:

```
HELD → CONFIRMED → ACTIVE → COMPLETED
                  → EXPIRED
```

Enforce rules:

* No invalid transitions
* Raise errors for illegal actions

---

### 2.3 Centralized Config

* Use a single config module
* Avoid scattered `os.getenv`

---

## Exit Criteria

* Clean separation of concerns
* Business logic reusable and testable
* Booking lifecycle is deterministic

---

# Phase 3 — Security & Access Control

**Goal:** Make system safe for real-world usage
**Time:** 2–4 days
**Priority:** 🟡 MEDIUM

## Tasks

### 3.1 Replace Admin Token with JWT

* Use signed tokens
* Add expiration
* Support roles

---

### 3.2 Role-Based Access Control

Roles:

* admin
* operator

---

### 3.3 Rate Limiting

* Protect critical endpoints:

  * `/hold`
  * `/scan`

---

### 3.4 Audit Logging

Track:

* who performed action
* timestamp
* action type

---

## Exit Criteria

* Unauthorized access is controlled
* Actions are traceable
* System resists abuse

---

# Phase 4 — Product Features

**Goal:** Increase product value
**Time:** ongoing
**Priority:** 🟢 LOW

## Tasks

### 4.1 Dashboard Analytics

* occupancy trends
* peak hours
* usage patterns

---

### 4.2 Smart Recommendations

* suggest parking slots
* optimize allocation

---

### 4.3 Replace External QR Service

* generate QR locally (frontend or backend)

---

## Exit Criteria

* Better UX
* Increased system intelligence

---

# Phase 5 — Production Infrastructure

**Goal:** Make system deployable at scale
**Time:** 3–5 days
**Priority:** 🟢 LOW

## Tasks

### 5.1 Nginx Setup

* Serve frontend
* Reverse proxy backend

---

### 5.2 CI/CD Pipeline

* GitHub Actions:

  * lint
  * test
  * build
  * deploy

---

### 5.3 Monitoring

* Metrics (Prometheus)
* Dashboard (Grafana)

---

### 5.4 Docker Optimization

* Separate dev vs production config

---

## Exit Criteria

* One-command deploy
* System observable in production
* Stable under load

---

# Development Strategy

## DO:

* Fix Phase 0 → Deploy immediately
* Iterate in small steps
* Test in real usage

## DO NOT:

* Over-engineer before deployment
* Add new features before stabilizing core

---

# Final Note

This system is already:

* Functionally complete
* Architecturally promising
* Close to production-ready

The next step is not more coding —
it is **controlled evolution into a reliable system**.

---
