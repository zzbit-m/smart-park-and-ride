import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from routers.admin import verify_admin_token
from redis_client import (
    HOLD_TTL_SECONDS,
    delete_qr_token_lookup,
    delete_slot_hold,
    get_all_slot_statuses,
    get_redis,
    get_slot_id_by_qr_token,
    get_slot_key,
    hold_slot,
    release_slot,
    set_qr_token_lookup,
)

router = APIRouter(prefix="/slots", tags=["slots"])

HOLD_DURATION_MINUTES = 15
PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001"


class SlotOut(BaseModel):
    id: int
    slot_code: str
    zone_id: int
    live_status: str


class HoldRequest(BaseModel):
    license_plate: str


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


SEED_SLOTS = (
    [("Zone A", "Tram Stop A", f"A{i:02d}") for i in range(1, 11)]
    + [("Zone B", "Tram Stop B", f"B{i:02d}") for i in range(1, 11)]
)


async def _get_or_create_zone(
    db: AsyncSession, name: str, tram_stop: str, total_slots: int
) -> tuple[int, bool]:
    result = await db.execute(
        text("SELECT id FROM parking_zones WHERE name = :name"),
        {"name": name},
    )
    row = result.fetchone()
    if row:
        return row.id, False

    result = await db.execute(
        text("""
            INSERT INTO parking_zones (name, tram_stop, total_slots)
            VALUES (:name, :tram_stop, :total_slots)
            RETURNING id
        """),
        {"name": name, "tram_stop": tram_stop, "total_slots": total_slots},
    )
    return result.fetchone().id, True


# Day-of-week lookup (PostgreSQL DOW: 0=Sunday)
_DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(db: AsyncSession = Depends(get_db)):
    """
    Return parking usage analytics for operational planning:
    - peak_hours: check-ins grouped by local hour, sorted by count desc
    - average_duration_minutes: mean session length for completed bookings
    - daily_traffic: check-ins grouped by day of week (local time)
    - summary_stats: completed / active / cancelled booking counts
    """

    # Run all four queries concurrently
    peak_q, duration_q, daily_q, summary_q = await asyncio.gather(
        db.execute(text("""
            SELECT
                EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'Asia/Bangkok')::int AS hour,
                COUNT(*) AS count
            FROM bookings
            WHERE checked_in_at IS NOT NULL
            GROUP BY 1
            ORDER BY count DESC
        """)),
        db.execute(text("""
            SELECT
                COALESCE(
                    AVG(
                        EXTRACT(EPOCH FROM (checked_out_at - checked_in_at)) / 60.0
                    ),
                    0
                ) AS avg_minutes
            FROM bookings
            WHERE status = 'completed'
              AND checked_in_at  IS NOT NULL
              AND checked_out_at IS NOT NULL
              AND checked_out_at > checked_in_at
        """)),
        db.execute(text("""
            SELECT
                EXTRACT(DOW FROM checked_in_at AT TIME ZONE 'Asia/Bangkok')::int AS dow,
                COUNT(*) AS count
            FROM bookings
            WHERE checked_in_at IS NOT NULL
            GROUP BY 1
            ORDER BY dow
        """)),
        db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'completed')                     AS total_completed,
                COUNT(*) FILTER (WHERE status IN ('held', 'confirmed'))           AS currently_active,
                COUNT(*) FILTER (WHERE status IN ('expired', 'no_show'))          AS total_cancelled
            FROM bookings
        """)),
    )

    # ── peak_hours ──
    peak_hours = [
        HourlyCount(hour=row.hour, count=row.count)
        for row in peak_q.fetchall()
    ]

    # ── average_duration_minutes ──
    dur_row = duration_q.fetchone()
    avg_minutes = round(float(dur_row.avg_minutes), 2) if dur_row else 0.0

    # ── daily_traffic ──
    daily_traffic = [
        DailyCount(
            day_of_week=row.dow,
            day_name=_DOW_NAMES[row.dow],
            count=row.count,
        )
        for row in daily_q.fetchall()
    ]

    # ── summary_stats ──
    s = summary_q.fetchone()
    summary = SummaryStats(
        total_completed=s.total_completed if s else 0,
        currently_active=s.currently_active if s else 0,
        total_cancelled=s.total_cancelled if s else 0,
    )

    return AnalyticsResponse(
        peak_hours=peak_hours,
        average_duration_minutes=avg_minutes,
        daily_traffic=daily_traffic,
        summary_stats=summary,
    )


@router.post("/seed", response_model=SeedResponse)
async def seed_slots(
    _: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db)
):
    """
    Temporary dev endpoint: seed zones, 20 parking slots (A1–A10, B1–B10),
    and the placeholder user for bookings.
    """
    await db.execute(
        text("""
            INSERT INTO users (id, phone, display_name, role)
            VALUES (:id, '0000000000', 'Dev User', 'user')
            ON CONFLICT (id) DO NOTHING
        """),
        {"id": PLACEHOLDER_USER_ID},
    )


    zones_created = 0
    slots_created = 0
    created_codes: list[str] = []
    zone_ids: dict[str, int] = {}

    for zone_name, tram_stop, slot_code in SEED_SLOTS:
        if zone_name not in zone_ids:
            zone_id, created = await _get_or_create_zone(
                db, zone_name, tram_stop, total_slots=10
            )
            zone_ids[zone_name] = zone_id
            if created:
                zones_created += 1

        result = await db.execute(
            text("""
                INSERT INTO parking_slots (zone_id, slot_code, last_known_status)
                VALUES (:zone_id, :slot_code, 'available')
                ON CONFLICT (slot_code) DO NOTHING
                RETURNING id
            """),
            {"zone_id": zone_ids[zone_name], "slot_code": slot_code},
        )
        row = result.fetchone()
        if row:
            slots_created += 1
            created_codes.append(slot_code)
            await get_redis().set(get_slot_key(row.id), "available")

    await db.commit()

    return SeedResponse(
        message="Seed complete",
        zones_created=zones_created,
        slots_created=slots_created,
        slot_codes=created_codes,
    )


@router.get("/", response_model=list[SlotOut])
async def list_slots(db: AsyncSession = Depends(get_db)):
    """List all parking slots with live status merged from PostgreSQL and Redis."""
    result = await db.execute(
        text(
            "SELECT id, slot_code, zone_id, last_known_status FROM parking_slots "
            "ORDER BY zone_id, slot_code"
        )
    )
    rows = result.fetchall()

    slot_ids = [row.id for row in rows]
    statuses = await get_all_slot_statuses(slot_ids)

    return [
        SlotOut(
            id=row.id,
            slot_code=row.slot_code,
            zone_id=row.zone_id,
            live_status=_merge_live_status(
                statuses.get(row.id, "available"),
                row.last_known_status,
            ),
        )
        for row in rows
    ]


def _merge_live_status(redis_status: str, pg_status: str) -> str:
    """Prefer Redis live state; fall back to PostgreSQL after scan-in clears Redis keys."""
    if redis_status != "available":
        return redis_status
    return pg_status


@router.post("/scan", response_model=ScanResponse)
async def scan_in(
    request: ScanRequest,
    _: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    """Gate entry: validate QR token via Redis, mark slot occupied in PostgreSQL.
    Requires a valid admin Bearer token in the Authorization header.
    """
    qr_token = request.qr_token.strip()
    if not qr_token:
        raise HTTPException(status_code=400, detail="Invalid or expired QR code")

    slot_id = await get_slot_id_by_qr_token(qr_token)
    if slot_id is None:
        raise HTTPException(status_code=400, detail="Invalid or expired QR code")

    await delete_qr_token_lookup(qr_token)
    await delete_slot_hold(slot_id)

    await db.execute(
        text("""
            UPDATE parking_slots
            SET last_known_status = 'occupied', updated_at = now()
            WHERE id = :sid
        """),
        {"sid": slot_id},
    )
    await db.execute(
        text("""
            UPDATE bookings
            SET status = 'confirmed', checked_in_at = now()
            WHERE qr_token = :qr_token AND status = 'held'
        """),
        {"qr_token": qr_token},
    )
    await db.commit()

    return ScanResponse(
        status="success",
        message="Gate opened",
        slot_id=slot_id,
    )


@router.post("/scan-out", response_model=ScanOutResponse)
async def scan_out(
    request: ScanRequest,
    _: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    """Gate exit: validate QR token, mark booking completed, free the slot.
    Requires a valid admin Bearer token in the Authorization header.
    """
    qr_token = request.qr_token.strip()
    if not qr_token:
        raise HTTPException(status_code=400, detail="QR token is required")

    # Look up the booking by qr_token — accept both confirmed (scanned-in) and held states
    result = await db.execute(
        text("""
            SELECT b.id, b.slot_id, b.status, ps.slot_code
            FROM bookings b
            JOIN parking_slots ps ON ps.id = b.slot_id
            WHERE b.qr_token = :qr_token
              AND b.status IN ('confirmed', 'held')
            LIMIT 1
        """),
        {"qr_token": qr_token},
    )
    row = result.fetchone()

    if not row:
        # Check whether it exists at all (already completed / expired / no_show)
        exists = await db.execute(
            text("SELECT status FROM bookings WHERE qr_token = :qr_token LIMIT 1"),
            {"qr_token": qr_token},
        )
        existing = exists.fetchone()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Booking already {existing.status} — cannot scan out again",
            )
        raise HTTPException(status_code=404, detail="QR token not found or already expired")

    booking_id = row.id
    slot_id    = row.slot_id
    slot_code  = row.slot_code

    # Release Redis live state → available (no TTL)
    await release_slot(slot_id)

    # Clean up any leftover QR token lookup key (defensive)
    await delete_qr_token_lookup(qr_token)

    # Mark booking completed + record checkout time
    await db.execute(
        text("""
            UPDATE bookings
            SET status = 'completed', checked_out_at = now()
            WHERE id = :bid
        """),
        {"bid": booking_id},
    )

    # Sync parking_slots persistent status
    await db.execute(
        text("""
            UPDATE parking_slots
            SET last_known_status = 'available', updated_at = now()
            WHERE id = :sid
        """),
        {"sid": slot_id},
    )

    await db.commit()

    return ScanOutResponse(
        status="success",
        message=f"Slot {slot_code} is now available",
        slot_id=slot_id,
        slot_code=slot_code,
    )



@router.post("/manual-release", response_model=ManualReleaseResponse)
async def manual_release(
    request: ManualReleaseRequest,
    _: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin override: force-release a slot by slot_code regardless of QR token.
    Used when a driver leaves without scanning out (forgotten checkout).
    Requires a valid admin Bearer token in the Authorization header.
    Marks the booking as completed and frees the slot in both Redis and PostgreSQL.
    """
    slot_code = request.slot_code.strip().upper()
    if not slot_code:
        raise HTTPException(status_code=400, detail="slot_code is required")

    # Resolve slot_code → slot_id and find any active booking in one query
    result = await db.execute(
        text("""
            SELECT
                ps.id        AS slot_id,
                ps.slot_code AS slot_code,
                b.id         AS booking_id,
                b.status     AS booking_status,
                b.qr_token   AS qr_token
            FROM parking_slots ps
            LEFT JOIN bookings b
                ON b.slot_id = ps.id
               AND b.status IN ('confirmed', 'held')
            WHERE ps.slot_code = :slot_code
            ORDER BY b.held_at DESC
            LIMIT 1
        """),
        {"slot_code": slot_code},
    )
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Slot '{slot_code}' not found")

    slot_id    = row.slot_id
    booking_id = row.booking_id

    if not booking_id:
        raise HTTPException(
            status_code=404,
            detail=f"Slot '{slot_code}' has no active booking — it may already be available",
        )

    # ── Release Redis (set back to available, remove TTL) ──
    await release_slot(slot_id)

    # ── Clean up QR token reverse-lookup key if present ──
    if row.qr_token:
        await delete_qr_token_lookup(row.qr_token)

    # ── Mark booking completed ──
    await db.execute(
        text("""
            UPDATE bookings
            SET status = 'completed', checked_out_at = now()
            WHERE id = :bid
        """),
        {"bid": booking_id},
    )

    # ── Sync persistent slot status ──
    await db.execute(
        text("""
            UPDATE parking_slots
            SET last_known_status = 'available', updated_at = now()
            WHERE id = :sid
        """),
        {"sid": slot_id},
    )

    await db.commit()

    return ManualReleaseResponse(
        status="success",
        message=f"Slot {slot_code} manually released — booking marked completed",
        slot_code=slot_code,
        booking_id=str(booking_id),
    )


@router.post("/{slot_id}/hold", response_model=HoldResponse)
async def hold_slot_endpoint(
    slot_id: int,
    body: HoldRequest,
    db: AsyncSession = Depends(get_db),
):
    """Hold a slot for 15 minutes (atomic Redis lock + PostgreSQL booking row).

    The request body must include a ``license_plate`` string so the booking can
    be linked to a specific vehicle for access-control purposes.
    """
    # ── Validate license plate ──────────────────────────────────────────────
    plate = body.license_plate.strip().upper()
    if not plate:
        raise HTTPException(status_code=422, detail="license_plate is required")
    if len(plate) > 20:
        raise HTTPException(status_code=422, detail="license_plate must be 20 characters or fewer")

    result = await db.execute(
        text("SELECT id, slot_code FROM parking_slots WHERE id = :sid"),
        {"sid": slot_id},
    )
    slot = result.fetchone()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")

    booking_id = str(uuid.uuid4())
    qr_token = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=HOLD_DURATION_MINUTES)

    acquired = await hold_slot(
        slot_id,
        booking_id,
        ttl_seconds=HOLD_TTL_SECONDS,
    )
    if not acquired:
        raise HTTPException(
            status_code=400,
            detail="Slot is already held or occupied",
        )

    try:
        await db.execute(
            text("""
                INSERT INTO bookings
                    (id, user_id, slot_id, status, qr_token, license_plate, held_at, expires_at)
                VALUES
                    (:id, :user_id, :slot_id, 'held', :qr_token, :license_plate, now(), :expires_at)
            """),
            {
                "id": booking_id,
                "user_id": PLACEHOLDER_USER_ID,
                "slot_id": slot_id,
                "qr_token": qr_token,
                "license_plate": plate,
                "expires_at": expires_at,
            },
        )
        await db.commit()
    except Exception:
        await release_slot(slot_id)
        raise

    await set_qr_token_lookup(qr_token, slot_id, ttl_seconds=HOLD_TTL_SECONDS)

    return HoldResponse(
        booking_id=booking_id,
        slot_id=slot_id,
        slot_code=slot.slot_code,
        expires_at=expires_at.isoformat(),
        qr_token=qr_token,
    )


@router.delete("/{slot_id}/hold")
async def release_hold(slot_id: int, db: AsyncSession = Depends(get_db)):
    """Release a held slot (used by frontend cancel / scan-out)."""
    token_row = await db.execute(
        text("""
            SELECT qr_token FROM bookings
            WHERE slot_id = :sid AND status = 'held'
        """),
        {"sid": slot_id},
    )
    token_result = token_row.fetchone()

    await release_slot(slot_id)

    if token_result:
        await delete_qr_token_lookup(token_result.qr_token)

    await db.execute(
        text("""
            UPDATE bookings SET status = 'expired'
            WHERE slot_id = :sid AND status = 'held'
        """),
        {"sid": slot_id},
    )
    await db.commit()

    return {"message": f"Slot {slot_id} released successfully"}
