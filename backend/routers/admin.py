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
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from redis_client import get_all_slot_statuses

router = APIRouter(prefix="/admin", tags=["admin"])

# ── Credentials — must be set via environment variables (no defaults) ─────────
_ADMIN_USERNAME: str | None = os.getenv("ADMIN_USERNAME")
_ADMIN_PASSWORD: str | None = os.getenv("ADMIN_PASSWORD")

if not _ADMIN_USERNAME or not _ADMIN_PASSWORD:
    raise RuntimeError(
        "Admin credentials must be provided via environment variables: "
        "ADMIN_USERNAME and ADMIN_PASSWORD"
    )

# Derive a deterministic token from the credentials + a salt so the token
# is stable across restarts (no JWT library required).
_SALT = "smart-park-and-ride-admin-salt-v1"
_EXPECTED_TOKEN: str = hmac.new(
    _SALT.encode(),
    f"{_ADMIN_USERNAME}:{_ADMIN_PASSWORD}".encode(),
    hashlib.sha256,
).hexdigest()


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
    Authenticate an admin user and return a Bearer token.
    Credentials are compared in constant time to prevent timing attacks.
    """
    username_ok = hmac.compare_digest(body.username, _ADMIN_USERNAME)
    password_ok = hmac.compare_digest(body.password, _ADMIN_PASSWORD)

    if not (username_ok and password_ok):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return LoginResponse(token=_EXPECTED_TOKEN, role="admin")


# ── Reusable auth dependency ────────────────────────────────────────────────────

async def verify_admin_token(authorization: str = Header(default="")) -> str:
    """
    FastAPI dependency — extract and validate the Bearer token.

    Usage:
        from routers.admin import verify_admin_token

        @router.post("/some-protected-endpoint")
        async def handler(
            _: str = Depends(verify_admin_token),
            db: AsyncSession = Depends(get_db),
        ):
            ...
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header (expected: Bearer <token>)",
        )

    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, _EXPECTED_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return token


# ── Stats endpoint ─────────────────────────────────────────────────────────────

class StatsResponse(BaseModel):
    total: int
    available: int
    held: int
    occupied: int


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    _: str = Depends(verify_admin_token),
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

