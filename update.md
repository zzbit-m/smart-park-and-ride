# Production Readiness Updates

This project was updated with a small set of production-readiness improvements.

## What changed

0. **Dynamic parking layout support**
   - Added `slot_status` column (VARCHAR, named constraint) to `parking_slots`
   - New Alembic migration: `f6a7b8c9d0e1_add_dynamic_layout_tables.py`
   - Created `parking_layouts` table (versioned JSONB config storage)
   - Created `parking_layout_slots` table (zone/slot grid with row/col coordinates)
   - Partial unique index `one_active_layout` enforcing single active layout
    - New service `backend/services/layout_sync.py` — `apply_layout()` validates config, detects slot conflicts, applies layout in a single transaction, syncs Redis, and audits changes
    - `preview_diff()` — read-only preview, returns slots_to_create/remove/conflicts/unchanged
    - `POST /api/admin/layout/upload` — apply layout (422 validation, 409 version/conflict)
    - `POST /api/admin/layout/diff` — preview diff (read-only)
    - `GET /api/admin/layout/current` — return active layout or null
    - `auto_seed.py` — skips hardcoded seed if active layout exists (layout-driven deployments)

1. **Analytics export summary endpoint**
   - Added `GET /api/admin/export/summary` in `backend/routers/admin.py`
   - Protected by `verify_admin_token` (admin-only)
   - Returns aggregated daily/weekly/monthly insights: total cars, avg duration, occupancy rate, peak hour, hourly distribution, slot utilization
   - Accepts optional `d=YYYY-MM-DD` and `r=day|week|month` query params

2. **Repository layer**
   - Created `backend/repositories/` package with `analytics_repo.py`
   - Contains pure SQL aggregate queries using `BETWEEN` for time-range filtering
   - No Python loops — all aggregation in PostgreSQL `GROUP BY`

3. **Analytics service layer**
   - Created `backend/services/analytics_service.py`
   - Computes date ranges (`_compute_date_range`) for day/week/month
   - Derives occupancy rate from unique slots used / total slots
   - Finds peak hour from hourly distribution via single `max()` pass

4. **Admin dashboard summary card**
   - Added Daily Summary card to dashboard panel with date picker and Day/Week/Month dropdown
   - Displays: total cars, avg duration, occupancy rate, peak hour, top slot
   - Download button exports aggregated summary as `parking_summary_<range>_<date>.json`

5. **Health check endpoint**
   - Added `GET /health` in `backend/main.py`
   - Verifies both PostgreSQL and Redis connectivity
   - Returns structured JSON with `status`, `checks`, `timestamp`, and `errors`
   - Responds with `503` if any dependency is degraded

2. **Sentry monitoring integration**
   - Added optional `SENTRY_DSN` and `SENTRY_TRACES_SAMPLE_RATE` in `backend/config.py`
   - Integrated Sentry middleware in `backend/main.py`
   - Logs a warning if `SENTRY_DSN` is set but `sentry-sdk` is not installed

3. **Database backup utility**
   - Added `backend/backup.py`
   - Uses `pg_dump` to create PostgreSQL backups
   - Saves backups under `BACKUP_DIR` (default `./backups`)
   - Cleans up backups older than `BACKUP_RETENTION_DAYS`
   - Optionally uploads backups to S3 when `BACKUP_S3_BUCKET` is configured and `--upload-s3` is provided

4. **Config additions**
   - Added the following env-configurable values in `backend/config.py`:
     - `BACKUP_DIR`
     - `BACKUP_RETENTION_DAYS`
     - `BACKUP_S3_BUCKET`
     - `BACKUP_S3_PREFIX`
     - `SENTRY_DSN`
     - `SENTRY_TRACES_SAMPLE_RATE`

5. **Dependencies**
   - Updated `backend/requirements.txt` to include:
     - `sentry-sdk`
     - `boto3`

6. **Vehicle type (car/motorcycle) support**
   - Added `vehicle_type` column to `user_vehicles` and `bookings` tables
   - New Alembic migration: `d4e5f6a7b8c9_add_vehicle_type.py`
   - Frontend toggle to choose car 🚗 or motorcycle 🏍️ when entering license plate
   - Vehicle type shown in saved vehicles list and booking ticket modal
   - Analytics summary now splits counts into `total_cars` and `total_motorcycles`
   - Audit logs include `vehicle_type` in hold events

## How to run

### Database migration
After pulling changes, run:
```bash
docker-compose exec backend alembic upgrade head
```

### Health check

Start the app and request:

```bash
uvicorn backend.main:app --reload
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{
  "status": "ok",
  "checks": {
    "postgres": true,
    "redis": true
  },
  "timestamp": "2026-06-09T...Z"
}
```

### Backup utility

Run a local backup:

```bash
python backend/backup.py
```

Run a backup and upload to S3:

```bash
export BACKUP_S3_BUCKET=my-bucket
python backend/backup.py --upload-s3
```

### Environment variables

Recommended additions for production:

- `DATABASE_URL`
- `REDIS_URL`
- `SENTRY_DSN`
- `BACKUP_DIR`
- `BACKUP_RETENTION_DAYS`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_PREFIX`

### Cron example

Run nightly backup at 03:00 UTC:

```cron
0 3 * * * /usr/bin/env python /path/to/backend/backup.py --upload-s3
```

---

## Round 2: Twilio SMS, admin-layout React SPA & baseline migration fix

### Twilio SMS integration
- Created `backend/services/sms.py` — sends OTP via Twilio REST API
- Config: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `DEBUG_OTP`
- `send_sms()` function returns `{"success": true, "provider": "twilio"|"debug"}`
- Integrated into `backend/routers/auth.py` — replaces hardcoded `console.log` OTP with real SMS
- Debug mode (`DEBUG_OTP=true`, default) logs OTP to console instead of sending
- Env vars added to `docker-compose.yml` and `.env.example`

### React admin-layout SPA
- Scaffolded Vite 5 + React 18 project at `frontend/admin-layout/`
- Components: `ZoneRow` (zone form), `SlotGrid` (grid editor), `GridPreview` (visual grid)
- Login flow: static `import` (fixed from dynamic `import()`)
- Grid preview logic matches backend `_generate_slot_code` (1×≤10 → no row prefix)
- Zone row field proportions balanced (name flex:2, rows/cols 60px, prefix 64px, type flex:1.2)
- Slot type values lowercased on submit to match backend CHECK constraint
- `admin.js` Layout tab → hard redirect to `/admin-layout/`
- FastAPI static serving via `ADMIN_LAYOUT_DIR` env var + Docker volume mount
- `window.APP_CONFIG` injected in both dev (`index.html`) and production build (via backend static route)

### Baseline migration fix
- Fixed `backend/migrations/versions/f7b8c9d0e1f2_normalize_slot_type_check.py`:
  - Added `IF NOT EXISTS` guards for idempotent replay
  - Wrapped type/index creation in `DO $$ ... $$` anonymous blocks
- Auto-seed skips if an active layout already exists

### Prod environment updates
- Default admin password: `admin123` (was `password123`)
- `.env.example` updated with new vars: `TWILIO_*`, `DEBUG_OTP`, `ADMIN_LAYOUT_DIR`, `ADMIN_PASSWORD`
- `SETUP.md`, `FEATURES.md`, `ARCHITECTURE.md`, `STATE.md` synced to current state
