"""
routers/admin.py — Admin authentication endpoints.

POST /api/admin/login
    Accepts { "username": "...", "password": "..." }
    Returns  { "token": "<opaque-bearer-token>", "role": "admin" }

verify_admin_token (FastAPI dependency)
    Reads the Authorization: Bearer <token> header and raises 401 if invalid.
    Import this into other routers to protect sensitive endpoints.
"""

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from redis_client import get_all_slot_statuses
from config import settings
from services.jwt_helper import create_access_token, decode_access_token
from services.audit import log_audit
from services.analytics_service import get_export_summary
from services.password_utils import verify_password
from datetime import date

router = APIRouter(prefix="/admin", tags=["admin"])

# ── Credentials — loaded from settings (validated on startup) ─────────────────
_ADMIN_USERNAME = settings.ADMIN_USERNAME
_ADMIN_PASSWORD = settings.ADMIN_PASSWORD


# ── Request / response models ──────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str


# ── Login endpoint ─────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def admin_login(body: LoginRequest):
    """
    Authenticate an admin or operator user and return a Bearer JWT token.
    Credentials are compared in constant time to prevent timing attacks.
    """
    admin_username_ok = hmac.compare_digest(body.username, _ADMIN_USERNAME)
    admin_password_ok = verify_password(body.password, _ADMIN_PASSWORD)

    operator_username_ok = hmac.compare_digest(body.username, settings.OPERATOR_USERNAME)
    operator_password_ok = verify_password(body.password, settings.OPERATOR_PASSWORD)

    if admin_username_ok and admin_password_ok:
        role = "admin"
    elif operator_username_ok and operator_password_ok:
        role = "operator"
    else:
        log_audit(body.username, "login_failed", "Invalid credentials provided")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"sub": body.username, "role": role})
    log_audit(body.username, "login_success", f"Successful login with role='{role}'")
    return LoginResponse(token=token, role=role)


# ── Reusable auth dependencies ──────────────────────────────────────────────────

async def verify_admin_token(authorization: str = Header(default="")) -> dict:
    """
    FastAPI dependency — extract and validate the Bearer token for admin-only endpoints.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header (expected: Bearer <token>)",
        )

    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Permission denied")

    return payload


async def verify_operator_token(authorization: str = Header(default="")) -> dict:
    """
    FastAPI dependency — extract and validate the Bearer token for admin or operator access.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header (expected: Bearer <token>)",
        )

    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if payload.get("role") not in ["admin", "operator"]:
        raise HTTPException(status_code=403, detail="Permission denied")

    return payload


# ── Stats endpoint ─────────────────────────────────────────────────────────────

class StatsResponse(BaseModel):
    total: int
    available: int
    held: int
    occupied: int


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    _: dict = Depends(verify_operator_token),
    db: AsyncSession = Depends(get_db),
):
    """
    Return live parking slot counts (available / held / occupied).
    Reads slot IDs from PostgreSQL then batch-fetches live status from Redis.
    Protected: requires Admin Bearer token.
    """
    # 1. Fetch all slot IDs from PostgreSQL
    result = await db.execute(text("SELECT id FROM parking_slots ORDER BY id"))
    slot_ids: list[int] = [row[0] for row in result.fetchall()]

    if not slot_ids:
        return StatsResponse(total=0, available=0, held=0, occupied=0)

    # 2. Batch-read live status from Redis (one MGET call)
    statuses: dict[int, str] = await get_all_slot_statuses(slot_ids)

    counts = {"available": 0, "held": 0, "occupied": 0}
    for slot_id in slot_ids:
        raw = statuses.get(slot_id, "available")
        if raw is None or raw == "available":
            counts["available"] += 1
        elif raw.startswith("held"):
            counts["held"] += 1
        elif raw.startswith("occupied"):
            counts["occupied"] += 1
        else:
            counts["available"] += 1  # unknown → treat as available

    return StatsResponse(
        total=len(slot_ids),
        available=counts["available"],
        held=counts["held"],
        occupied=counts["occupied"],
    )


@router.get("/export")
async def export_data(
    _: dict = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    """
    Export slots, bookings, and audit logs (if table exists) as a JSON file download.
    Protected: requires Admin Bearer token.
    """
    # 1. Fetch slots
    slots_res = await db.execute(text("SELECT * FROM parking_slots ORDER BY slot_code"))
    slots = [dict(row._mapping) for row in slots_res.fetchall()]

    # 2. Fetch bookings
    bookings_res = await db.execute(text("SELECT * FROM bookings ORDER BY held_at DESC"))
    bookings = [dict(row._mapping) for row in bookings_res.fetchall()]

    # 3. Check if audit_logs table exists and fetch if so
    audit_logs = None
    table_check = await db.execute(text(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs')"
    ))
    if table_check.scalar():
        audit_res = await db.execute(text("SELECT * FROM audit_logs ORDER BY created_at DESC"))
        audit_logs = [dict(row._mapping) for row in audit_res.fetchall()]

    export_payload = {
        "slots": slots,
        "bookings": bookings,
    }
    if audit_logs is not None:
        export_payload["audit_logs"] = audit_logs

    from fastapi.encoders import jsonable_encoder
    import json

    json_data = json.dumps(jsonable_encoder(export_payload), indent=2, ensure_ascii=False)

    return Response(
        content=json_data,
        media_type="application/json",
        headers={
            "Content-Disposition": "attachment; filename=smart_park_export.json"
        }
    )


@router.get("/export/summary")
async def export_summary(
    _: dict = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
    d: str | None = None,
    r: str = "day",
):
    if r not in ("day", "week", "month"):
        raise HTTPException(status_code=422, detail="r must be one of: day, week, month")
    target_date = date.fromisoformat(d) if d else date.today()
    summary = await get_export_summary(db, target_date, r)
    return summary
