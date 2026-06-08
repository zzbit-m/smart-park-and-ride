# Project Context — Smart Park & Ride

## Overview

This is a parking management system with:

* Slot booking
* QR-based check-in / check-out
* Admin override
* Redis for locking / temporary state
* PostgreSQL for persistence

---

## Tech Stack

* Backend: FastAPI
* Database: PostgreSQL
* Cache/Lock: Redis
* Frontend: Vanilla JS / Vite
* Deployment: Docker

---

## Architecture Rules

### 1. Source of Truth

* PostgreSQL = source of truth
* Redis = cache / lock only

---

### 2. API Design

* Routes should be thin
* Business logic belongs in services
* Database logic belongs in repositories

---

### 3. Booking Lifecycle

States:

* HELD
* CONFIRMED
* ACTIVE
* COMPLETED
* EXPIRED

Rules:

* No invalid transitions allowed
* All updates must be consistent across Redis + PostgreSQL

---

### 4. Security Rules

* No hardcoded credentials
* All admin endpoints must be protected
* CORS must be restricted

---

### 5. Coding Rules

* Keep functions small
* Avoid duplication
* Prefer clarity over cleverness

---

## Current Phase

Phase 0 → Phase 1 (stabilization)

---

## Known Issues

* No background expiry worker
* No structured logging
* No JWT auth yet

---

## Goal

Stabilize system and make it production-ready before adding new features
