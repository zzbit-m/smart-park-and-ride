import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from services.booking_state import BookingStateMachine
from services.audit import log_audit

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
    occupy_slot,
)

logger = logging.getLogger(__name__)

HOLD_DURATION_MINUTES = 15
PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001"

_DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

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


def _merge_live_status(redis_status: str, pg_status: str) -> str:
    """Prefer Redis live state; fall back to PostgreSQL after scan-in clears Redis keys."""
    if redis_status != "available":
        return redis_status
    return pg_status


async def get_analytics(db: AsyncSession) -> dict:
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
        {"hour": row.hour, "count": row.count}
        for row in peak_q.fetchall()
    ]

    # ── average_duration_minutes ──
    dur_row = duration_q.fetchone()
    avg_minutes = round(float(dur_row.avg_minutes), 2) if dur_row else 0.0

    # ── daily_traffic ──
    daily_traffic = [
        {
            "day_of_week": row.dow,
            "day_name": _DOW_NAMES[row.dow],
            "count": row.count,
        }
        for row in daily_q.fetchall()
    ]

    # ── summary_stats ──
    s = summary_q.fetchone()
    summary = {
        "total_completed": s.total_completed if s else 0,
        "currently_active": s.currently_active if s else 0,
        "total_cancelled": s.total_cancelled if s else 0,
    }

    return {
        "peak_hours": peak_hours,
        "average_duration_minutes": avg_minutes,
        "daily_traffic": daily_traffic,
        "summary_stats": summary,
    }


async def seed_slots(db: AsyncSession, actor: str) -> dict:
    """
    Temporary dev endpoint logic: seed zones, 20 parking slots (A1–A10, B1–B10),
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
    log_audit(actor, "seed_slots", "Seeded parking slots and default users")

    return {
        "message": "Seed complete",
        "zones_created": zones_created,
        "slots_created": slots_created,
        "slot_codes": created_codes,
    }


async def list_slots(db: AsyncSession) -> list[dict]:
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
        {
            "id": row.id,
            "slot_code": row.slot_code,
            "zone_id": row.zone_id,
            "live_status": _merge_live_status(
                statuses.get(row.id, "available"),
                row.last_known_status,
            ),
        }
        for row in rows
    ]


async def scan_in(db: AsyncSession, qr_token: str, actor: str) -> dict:
    """Gate entry logic: validate QR token via Redis, mark slot occupied in PostgreSQL."""
    qr_token = qr_token.strip()
    if not qr_token:
        logger.warning("Scan-in attempted with empty QR token")
        raise HTTPException(status_code=400, detail="Invalid or expired QR code")

    slot_id = await get_slot_id_by_qr_token(qr_token)
    if slot_id is None:
        logger.warning(f"Scan-in failed: invalid or expired QR token '{qr_token}'")
        raise HTTPException(status_code=400, detail="Invalid or expired QR code")

    res = await db.execute(
        text("SELECT id, status FROM bookings WHERE qr_token = :qr_token LIMIT 1"),
        {"qr_token": qr_token}
    )
    booking = res.fetchone()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    BookingStateMachine.check_transition(booking.status, "confirmed")

    await delete_qr_token_lookup(qr_token)
    await occupy_slot(slot_id, str(booking.id))

    try:
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
                WHERE qr_token = :qr_token
            """),
            {"qr_token": qr_token},
        )
        await db.commit()
        log_audit(actor, "scan_in", f"Scanned in QR token (slot_id={slot_id})")
        logger.info(f"Scan-in successful: gate opened for slot_id={slot_id}, qr_token={qr_token}")
    except Exception as e:
        logger.error(f"Error during scan-in database updates for slot_id={slot_id}: {e}", exc_info=True)
        raise

    return {
        "status": "success",
        "message": "Gate opened",
        "slot_id": slot_id,
    }


async def scan_out(db: AsyncSession, qr_token: str, actor: str) -> dict:
    """Gate exit logic: validate QR token, mark booking completed, free the slot."""
    qr_token = qr_token.strip()
    if not qr_token:
        logger.warning("Scan-out failed: QR token is required")
        raise HTTPException(status_code=400, detail="QR token is required")

    # Look up the booking by qr_token
    result = await db.execute(
        text("""
            SELECT b.id, b.slot_id, b.status, ps.slot_code
            FROM bookings b
            JOIN parking_slots ps ON ps.id = b.slot_id
            WHERE b.qr_token = :qr_token
            LIMIT 1
        """),
        {"qr_token": qr_token},
    )
    row = result.fetchone()

    if not row:
        logger.warning(f"Scan-out failed: QR token not found or already expired for qr_token='{qr_token}'")
        raise HTTPException(status_code=404, detail="QR token not found or already expired")

    BookingStateMachine.check_transition(row.status, "completed")

    booking_id = row.id
    slot_id = row.slot_id
    slot_code = row.slot_code

    # Release Redis live state → available (no TTL)
    await release_slot(slot_id)

    # Clean up any leftover QR token lookup key (defensive)
    await delete_qr_token_lookup(qr_token)

    try:
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
        log_audit(actor, "scan_out", f"Scanned out QR token (slot_id={slot_id}, slot_code={slot_code})")
        logger.info(f"Scan-out successful: slot {slot_code} (id={slot_id}) released, booking {booking_id} completed.")
    except Exception as e:
        logger.error(f"Error during scan-out database updates for booking {booking_id}: {e}", exc_info=True)
        raise

    return {
        "status": "success",
        "message": f"Slot {slot_code} is now available",
        "slot_id": slot_id,
        "slot_code": slot_code,
    }


async def manual_release(db: AsyncSession, slot_code: str, actor: str) -> dict:
    """
    Admin override logic: force-release a slot by slot_code regardless of QR token.
    Marks the booking as completed and frees the slot in both Redis and PostgreSQL.
    """
    slot_code = slot_code.strip().upper()
    if not slot_code:
        logger.warning("Manual release failed: slot_code is required")
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
            WHERE ps.slot_code = :slot_code
            ORDER BY b.held_at DESC
            LIMIT 1
        """),
        {"slot_code": slot_code},
    )
    row = result.fetchone()

    if not row:
        logger.warning(f"Manual release failed: Slot '{slot_code}' not found")
        raise HTTPException(status_code=404, detail=f"Slot '{slot_code}' not found")

    slot_id = row.slot_id
    booking_id = row.booking_id
    booking_status = row.booking_status

    if not booking_id:
        logger.warning(f"Manual release failed: Slot '{slot_code}' has no active booking")
        raise HTTPException(
            status_code=404,
            detail=f"Slot '{slot_code}' has no active booking — it may already be available",
        )

    BookingStateMachine.check_transition(booking_status, "completed")

    # ── Release Redis (set back to available, remove TTL) ──
    await release_slot(slot_id)

    # ── Clean up QR token reverse-lookup key if present ──
    if row.qr_token:
        await delete_qr_token_lookup(row.qr_token)

    try:
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
        log_audit(actor, "manual_release", f"Manually released slot {slot_code} (booking_id={booking_id})")
        logger.info(f"Manual release successful: Slot {slot_code} (id={slot_id}) force-released, booking {booking_id} marked completed.")
    except Exception as e:
        logger.error(f"Error during manual release database updates for slot {slot_code}: {e}", exc_info=True)
        raise

    return {
        "status": "success",
        "message": f"Slot {slot_code} manually released — booking marked completed",
        "slot_code": slot_code,
        "booking_id": str(booking_id),
    }


async def hold_slot(
    db: AsyncSession,
    slot_id: int,
    license_plate: str,
    province: str,
    user_id: str,
    actor: str
) -> dict:
    """Hold a slot for 15 minutes (atomic Redis lock + PostgreSQL booking row)."""
    plate = license_plate.strip().upper()
    prov = province.strip()
    if not plate:
        logger.warning(f"Hold booking failed: license_plate missing for slot_id={slot_id}")
        raise HTTPException(status_code=422, detail="license_plate is required")
    if len(plate) > 20:
        logger.warning(f"Hold booking failed: license_plate too long ('{plate}') for slot_id={slot_id}")
        raise HTTPException(status_code=422, detail="license_plate must be 20 characters or fewer")
    if not prov:
        logger.warning(f"Hold booking failed: province missing for slot_id={slot_id}")
        raise HTTPException(status_code=422, detail="province is required")

    # Check if user is currently banned
    user_check = await db.execute(
        text("SELECT banned_until FROM users WHERE id = :uid"),
        {"uid": user_id}
    )
    user_row = user_check.fetchone()
    if user_row and user_row.banned_until:
        banned_until = user_row.banned_until
        if banned_until.tzinfo is None:
            banned_until = banned_until.replace(tzinfo=timezone.utc)
        if banned_until > datetime.now(timezone.utc):
            logger.warning(f"Hold booking failed: user {user_id} is banned until {banned_until.isoformat()}")
            raise HTTPException(
                status_code=403,
                detail=f"You are temporarily banned from making reservations due to multiple no-shows. Banned until {banned_until.isoformat()}."
            )

    import re
    THAI_PLATE_REGEX = re.compile(r"^[1-9]?[ก-ฮ]+\s\d{1,4}$")
    if not THAI_PLATE_REGEX.match(plate):
        logger.warning(f"Hold booking failed: license_plate '{plate}' does not match Thai format")
        raise HTTPException(
            status_code=422,
            detail="Invalid Thai license plate format (expected: e.g. กข 1234 or 1กข 1234)"
        )

    # Check for duplicate active booking for this vehicle
    dup_check = await db.execute(
        text("""
            SELECT id FROM bookings
            WHERE license_plate = :plate AND status IN ('held', 'confirmed')
            LIMIT 1
        """),
        {"plate": plate}
    )
    if dup_check.fetchone():
        logger.warning(f"Hold booking failed: vehicle '{plate}' already has an active booking")
        raise HTTPException(
            status_code=400,
            detail="This vehicle already has an active reservation or is currently parked."
        )

    result = await db.execute(
        text("SELECT id, slot_code, last_known_status FROM parking_slots WHERE id = :sid"),
        {"sid": slot_id},
    )
    slot = result.fetchone()
    if not slot:
        logger.warning(f"Hold booking failed: slot_id={slot_id} not found")
        raise HTTPException(status_code=404, detail="Slot not found")

    if slot.last_known_status == "occupied":
        logger.warning(f"Hold booking failed: slot_id={slot_id} is occupied in DB")
        raise HTTPException(
            status_code=400,
            detail="Slot is currently occupied and cannot be held",
        )

    booking_id = str(uuid.uuid4())
    qr_token = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=HOLD_DURATION_MINUTES)

    # Use hold_slot function imported from redis_client under alias to avoid name shadowing
    from redis_client import hold_slot as redis_hold_slot
    acquired = await redis_hold_slot(
        slot_id,
        booking_id,
        ttl_seconds=HOLD_TTL_SECONDS,
    )
    if not acquired:
        logger.warning(f"Hold booking failed: slot_id={slot_id} is already held or occupied")
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
                "user_id": user_id,
                "slot_id": slot_id,
                "qr_token": qr_token,
                "license_plate": plate,
                "expires_at": expires_at,
            },
        )
        
        # Save vehicle into user registry
        await db.execute(
            text("""
                INSERT INTO user_vehicles (user_id, license_plate, province)
                VALUES (:user_id, :license_plate, :province)
                ON CONFLICT (user_id, license_plate, province) DO NOTHING
            """),
            {
                "user_id": user_id,
                "license_plate": plate,
                "province": prov,
            },
        )
        
        await db.commit()

    except Exception as e:
        logger.error(f"Failed to create hold booking in database: slot_id={slot_id}, booking_id={booking_id}. Error: {e}", exc_info=True)
        await release_slot(slot_id)
        raise

    await set_qr_token_lookup(qr_token, slot_id, ttl_seconds=HOLD_TTL_SECONDS)
    log_audit(actor, "hold_slot", f"Created hold for slot_id={slot_id} (confidential plate)")
    logger.info(f"Created hold booking: booking_id={booking_id}, slot_id={slot_id}, expires_at='{expires_at.isoformat()}'")

    return {
        "booking_id": booking_id,
        "slot_id": slot_id,
        "slot_code": slot.slot_code,
        "expires_at": expires_at.isoformat(),
        "qr_token": qr_token,
    }


async def release_hold(db: AsyncSession, slot_id: int, qr_token: str, user_id: str | None = None, actor: str = "driver") -> dict:
    """Release a held slot (used by frontend cancel / scan-out)."""
    # Fetch the active hold booking for this slot and ensure it belongs to the authenticated user.
    token_row = await db.execute(
        text("""
            SELECT qr_token, status, user_id FROM bookings
            WHERE slot_id = :sid AND status = 'held'
        """),
        {"sid": slot_id},
    )
    token_result = token_row.fetchone()

    if not token_result:
        raise HTTPException(status_code=404, detail="No active hold found for slot")

    if user_id is None or str(token_result.user_id) != user_id:
        logger.warning(f"User {user_id} attempted to release hold owned by User {token_result.user_id}")
        raise HTTPException(
            status_code=403,
            detail="Permission denied: You do not own this booking"
        )

    if not qr_token or token_result.qr_token != qr_token:
        logger.warning(f"Unauthorized release hold attempt on slot_id={slot_id} with token='{qr_token}'")
        raise HTTPException(
            status_code=403,
            detail="Permission denied: Invalid hold validation token"
        )

    await release_slot(slot_id)

    if token_result:
        await delete_qr_token_lookup(token_result.qr_token)

    try:
        await db.execute(
            text("""
                UPDATE bookings SET status = 'expired'
                WHERE slot_id = :sid AND status = 'held'
            """),
            {"sid": slot_id},
        )
        await db.commit()
        log_audit(actor, "release_hold", f"Released hold for slot_id={slot_id}")
        logger.info(f"Cancelled hold successfully for slot_id={slot_id}.")
    except Exception as e:
        logger.error(f"Error during release_hold database updates for slot_id={slot_id}: {e}", exc_info=True)
        raise

    return {"message": f"Slot {slot_id} released successfully"}
