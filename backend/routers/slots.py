import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from redis_client import (
    HOLD_TTL_SECONDS,
    get_all_slot_statuses,
    get_redis,
    get_slot_key,
    hold_slot,
    release_slot,
)

router = APIRouter(prefix="/slots", tags=["slots"])

HOLD_DURATION_MINUTES = 15
PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001"


class SlotOut(BaseModel):
    id: int
    slot_code: str
    zone_id: int
    live_status: str


class HoldResponse(BaseModel):
    booking_id: str
    slot_id: int
    slot_code: str
    expires_at: str
    qr_token: str


class SeedResponse(BaseModel):
    message: str
    zones_created: int
    slots_created: int
    slot_codes: list[str]


SEED_SLOTS = (
    [("Zone A", "Tram Stop A", f"A{i}") for i in range(1, 11)]
    + [("Zone B", "Tram Stop B", f"B{i}") for i in range(1, 11)]
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


@router.post("/seed", response_model=SeedResponse)
async def seed_slots(db: AsyncSession = Depends(get_db)):
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
            "SELECT id, slot_code, zone_id FROM parking_slots "
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
            live_status=statuses.get(row.id, "available"),
        )
        for row in rows
    ]


@router.post("/{slot_id}/hold", response_model=HoldResponse)
async def hold_slot_endpoint(slot_id: int, db: AsyncSession = Depends(get_db)):
    """Hold a slot for 15 minutes (atomic Redis lock + PostgreSQL booking row)."""
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
                INSERT INTO bookings (id, user_id, slot_id, status, qr_token, held_at, expires_at)
                VALUES (:id, :user_id, :slot_id, 'held', :qr_token, now(), :expires_at)
            """),
            {
                "id": booking_id,
                "user_id": PLACEHOLDER_USER_ID,
                "slot_id": slot_id,
                "qr_token": qr_token,
                "expires_at": expires_at,
            },
        )
        await db.commit()
    except Exception:
        await release_slot(slot_id)
        raise

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
    await release_slot(slot_id)

    await db.execute(
        text("""
            UPDATE bookings SET status = 'expired'
            WHERE slot_id = :sid AND status = 'held'
        """),
        {"sid": slot_id},
    )
    await db.commit()

    return {"message": f"Slot {slot_id} released successfully"}
