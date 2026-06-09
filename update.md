# Production Readiness Updates

This project was updated with a small set of production-readiness improvements.

## What changed

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

## How to run

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
