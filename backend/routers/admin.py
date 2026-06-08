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
import hashlib

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from redis_client import get_all_slot_statuses
from config import settings
from services.jwt_helper import create_access_token, decode_access_token
from services.audit import log_audit

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
    admin_password_ok = hmac.compare_digest(body.password, _ADMIN_PASSWORD)

    operator_username_ok = hmac.compare_digest(body.username, settings.OPERATOR_USERNAME)
    operator_password_ok = hmac.compare_digest(body.password, settings.OPERATOR_PASSWORD)

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
    raw_statuses: list[str | None] = await get_all_slot_statuses(slot_ids)

    counts = {"available": 0, "held": 0, "occupied": 0}
    for raw in raw_statuses:
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

