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

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/admin", tags=["admin"])

# ── Hardcoded credentials (replace with DB lookup + bcrypt in production) ──
_ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin")
_ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "password123")

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
