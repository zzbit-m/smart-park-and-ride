# Smart Park & Ride — Auto Prompt Pack (Phase-Based)

## How to Use

* Paste 1 prompt per task
* Replace placeholders (`<...>`)
* Feed into AI (GPT / Claude / Cursor)
* Iterate step-by-step

---

# 🔴 Phase 0 — Critical Fixes (Security & Config)

## Prompt 0.1 — Secure Admin Credentials

You are a senior backend engineer.

Task:
Fix insecure admin credential defaults in a FastAPI project.

Requirements:

* Remove default fallback values from environment variables
* Add a startup validation that crashes the app if credentials are missing
* Keep it production-safe

Code: <paste admin.py>

Return:

* Updated code
* Short explanation

---

## Prompt 0.2 — Fix Frontend API Config

You are a frontend engineer.

Task:
Replace hardcoded API base URL with environment-based configuration.

Requirements:

* Use environment variables (Vite or similar)
* Provide fallback for local development
* Ensure it works in production

Code: <paste app.js or config file>

---

## Prompt 0.3 — Restrict CORS

You are a backend security engineer.

Task:
Fix overly permissive CORS settings in FastAPI.

Requirements:

* Replace wildcard origins
* Allow only trusted domains
* Keep dev + prod compatibility

Code: <paste main.py>

---

## Prompt 0.4 — Protect Admin/Seed Endpoints

You are a backend security engineer.

Task:
Secure sensitive endpoints using dependency injection.

Requirements:

* Add authentication dependency
* Ensure only admin can access
* Do not break existing routes

Code: <paste router code>

---

# 🔴 Phase 1 — Stability & Reliability

## Prompt 1.1 — Background Expiry Worker

You are a backend engineer specializing in async systems.

Task:
Implement a background worker that syncs expired Redis holds with PostgreSQL.

Requirements:

* Runs every 60 seconds
* Finds expired holds
* Updates booking status to EXPIRED
* Safe for concurrent execution

Context:

* Redis = temporary hold
* PostgreSQL = persistent storage

---

## Prompt 1.2 — Logging System

You are a production backend engineer.

Task:
Add structured logging to a FastAPI app.

Requirements:

* Log key events (booking, scan, errors)
* Use Python logging (or better)
* Keep logs readable and useful

Code: <paste main.py>

---

## Prompt 1.3 — Global Error Handler

You are a backend engineer.

Task:
Implement global exception handling middleware.

Requirements:

* Standardize error responses
* Prevent leaking stack traces
* Handle validation + server errors

---

## Prompt 1.4 — Environment Setup

You are a DevOps engineer.

Task:
Create a proper environment configuration system.

Requirements:

* Generate `.env.example`
* Document required variables
* Ensure app reads from env cleanly

---

# 🟡 Phase 2 — Architecture Refactor

## Prompt 2.1 — Service Layer Refactor

You are a senior software architect.

Task:
Refactor a FastAPI project to introduce a service layer.

Requirements:

* Move business logic out of routes
* Keep routes thin
* Maintain existing functionality

Code: <paste route-heavy file>

---

## Prompt 2.2 — Repository Layer

You are a backend engineer.

Task:
Create a repository layer for database access.

Requirements:

* Abstract DB queries
* Keep services clean
* Support PostgreSQL

---

## Prompt 2.3 — Booking State Machine

You are a system designer.

Task:
Implement a strict booking state machine.

Requirements:

* Define valid states
* Enforce transitions
* Prevent invalid state changes

---

## Prompt 2.4 — Centralized Config

You are a backend engineer.

Task:
Refactor configuration into a centralized module.

Requirements:

* Avoid scattered os.getenv
* Use a config class
* Support environment overrides

---

# 🟡 Phase 3 — Security & Access Control

## Prompt 3.1 — JWT Authentication

You are a backend security engineer.

Task:
Replace simple admin token with JWT authentication.

Requirements:

* Signed tokens
* Expiration
* Secure verification

---

## Prompt 3.2 — Role-Based Access Control

You are a backend architect.

Task:
Implement RBAC (role-based access control).

Requirements:

* Roles: admin, operator
* Restrict endpoints based on role

---

## Prompt 3.3 — Rate Limiting

You are a backend engineer.

Task:
Add rate limiting to critical endpoints.

Requirements:

* Prevent abuse
* Keep implementation simple
* Use existing libraries if possible

---

## Prompt 3.4 — Audit Logging

You are a backend engineer.

Task:
Implement audit logging.

Requirements:

* Log user actions
* Include timestamp + action type
* Store in database or logs

---

# 🟢 Phase 4 — Product Features

## Prompt 4.1 — Analytics Dashboard Backend

You are a backend engineer.

Task:
Design analytics endpoints.

Requirements:

* occupancy trends
* usage stats
* time-based queries

---

## Prompt 4.2 — Smart Recommendations

You are a system designer.

Task:
Design a smart parking recommendation system.

Requirements:

* Suggest best available slots
* Consider usage patterns
* Keep MVP simple

---

## Prompt 4.3 — QR Code Generation

You are a full-stack engineer.

Task:
Replace external QR API with local generation.

Requirements:

* No external dependency
* Works offline
* Fast rendering

---

# 🟢 Phase 5 — Infrastructure & Deployment

## Prompt 5.1 — Nginx Setup

You are a DevOps engineer.

Task:
Create nginx configuration for serving frontend + proxy backend.

---

## Prompt 5.2 — CI/CD Pipeline

You are a DevOps engineer.

Task:
Create GitHub Actions pipeline.

Requirements:

* lint
* test
* build
* deploy

---

## Prompt 5.3 — Monitoring Setup

You are an SRE engineer.

Task:
Add monitoring to the system.

Requirements:

* metrics collection
* dashboard visualization
* alerting basics

---

## Prompt 5.4 — Docker Optimization

You are a DevOps engineer.

Task:
Optimize Docker setup for production.

Requirements:

* separate dev/prod configs
* reduce image size
* improve startup reliability

---

# Final Tip

Always run prompts in this order:

1. Phase 0 (must)
2. Phase 1 (stability)
3. Deploy
4. Continue Phase 2+

Avoid skipping phases — this system depends on consistency.
