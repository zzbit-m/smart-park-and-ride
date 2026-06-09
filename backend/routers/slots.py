from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from routers.admin import verify_admin_token, verify_operator_token
from routers.users import verify_user_token
from services import slot_service
from config import settings
from services.rate_limit import RateLimiter

router = APIRouter(prefix="/slots", tags=["slots"])


class SlotOut(BaseModel):
    id: int
    slot_code: str
    zone_id: int
    live_status: str


class HoldRequest(BaseModel):
    license_plate: str
    province: str = "กรุงเทพมหานคร"


class HoldResponse(BaseModel):
    booking_id: str
    slot_id: int
    slot_code: str
    expires_at: str
    qr_token: str


class ScanRequest(BaseModel):
    qr_token: str


class ScanResponse(BaseModel):
    status: str
    message: str
    slot_id: int


class ScanOutResponse(BaseModel):
    status: str
    message: str
    slot_id: int
    slot_code: str


class ManualReleaseRequest(BaseModel):
    slot_code: str


class ManualReleaseResponse(BaseModel):
    status: str
    message: str
    slot_code: str
    booking_id: str


class SeedResponse(BaseModel):
    message: str
    zones_created: int
    slots_created: int
    slot_codes: list[str]


# ── Analytics models ──────────────────────────────────────────────────────────

class HourlyCount(BaseModel):
    hour: int
    count: int


class DailyCount(BaseModel):
    day_of_week: int    # 0 = Sunday … 6 = Saturday (PostgreSQL EXTRACT DOW)
    day_name: str
    count: int


class SummaryStats(BaseModel):
    total_completed: int
    currently_active: int   # status IN ('held', 'confirmed')
    total_cancelled: int    # status IN ('expired', 'no_show')


class AnalyticsResponse(BaseModel):
    peak_hours: list[HourlyCount]
    average_duration_minutes: float
    daily_traffic: list[DailyCount]
    summary_stats: SummaryStats


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(
    _: dict = Depends(verify_operator_token),
    db: AsyncSession = Depends(get_db),
):
    """
    Return parking usage analytics for operational planning:
    - peak_hours: check-ins grouped by local hour, sorted by count desc
    - average_duration_minutes: mean session length for completed bookings
    - daily_traffic: check-ins grouped by day of week (local time)
    - summary_stats: completed / active / cancelled booking counts
    """
    return await slot_service.get_analytics(db)


@router.post("/seed", response_model=SeedResponse)
async def seed_slots(
    auth_payload: dict = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db)
):
    """
    Temporary dev endpoint: seed zones, 20 parking slots (A1–A10, B1–B10),
    and the placeholder user for bookings.
    """
    import os
    from fastapi import HTTPException
    if os.getenv("ENV", "").lower() == "production":
        raise HTTPException(
            status_code=403,
            detail="Database seeding is disabled in production environments."
        )
    actor = auth_payload.get("sub", "unknown_admin")
    return await slot_service.seed_slots(db, actor=actor)


@router.get("/", response_model=list[SlotOut])
async def list_slots(db: AsyncSession = Depends(get_db)):
    """List all parking slots with live status merged from PostgreSQL and Redis."""
    return await slot_service.list_slots(db)


@router.post("/scan", response_model=ScanResponse)
async def scan_in(
    request: ScanRequest,
    auth_payload: dict = Depends(verify_operator_token),
    db: AsyncSession = Depends(get_db),
    __ = Depends(RateLimiter("scan", settings.LIMIT_SCAN, settings.WINDOW_SCAN)),
):
    """Gate entry: validate QR token via Redis, mark slot occupied in PostgreSQL.
    Requires a valid admin Bearer token in the Authorization header.
    """
    actor = auth_payload.get("sub", "unknown_operator")
    return await slot_service.scan_in(db, request.qr_token, actor=actor)


@router.post("/scan-out", response_model=ScanOutResponse)
async def scan_out(
    request: ScanRequest,
    auth_payload: dict = Depends(verify_operator_token),
    db: AsyncSession = Depends(get_db),
):
    """Gate exit: validate QR token, mark booking completed, free the slot.
    Requires a valid admin Bearer token in the Authorization header.
    """
    actor = auth_payload.get("sub", "unknown_operator")
    return await slot_service.scan_out(db, request.qr_token, actor=actor)


@router.post("/manual-release", response_model=ManualReleaseResponse)
async def manual_release(
    request: ManualReleaseRequest,
    auth_payload: dict = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin override: force-release a slot by slot_code regardless of QR token.
    Used when a driver leaves without scanning out (forgotten checkout).
    Requires a valid admin Bearer token in the Authorization header.
    Marks the booking as completed and frees the slot in both Redis and PostgreSQL.
    """
    actor = auth_payload.get("sub", "unknown_admin")
    return await slot_service.manual_release(db, request.slot_code, actor=actor)


@router.post("/{slot_id}/hold", response_model=HoldResponse)
async def hold_slot_endpoint(
    slot_id: int,
    body: HoldRequest,
    db: AsyncSession = Depends(get_db),
    auth_payload: dict = Depends(verify_user_token),
    __ = Depends(RateLimiter("hold", settings.LIMIT_HOLD, settings.WINDOW_HOLD)),
):
    """Hold a slot for 15 minutes (atomic Redis lock + PostgreSQL booking row).

    The request body must include a ``license_plate`` string so the booking can
    be linked to a specific vehicle for access-control purposes.
    """
    user_id = auth_payload.get("sub")
    return await slot_service.hold_slot(
        db,
        slot_id,
        body.license_plate,
        province=body.province,
        user_id=user_id,
        actor="driver"
    )



@router.delete("/{slot_id}/hold")
async def release_hold(
    slot_id: int,
    qr_token: str,
    db: AsyncSession = Depends(get_db),
    auth_payload: dict = Depends(verify_user_token),
):
    """Release a held slot (used by frontend cancel / scan-out)."""
    user_id = auth_payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return await slot_service.release_hold(db, slot_id, qr_token, user_id=user_id, actor="driver")

