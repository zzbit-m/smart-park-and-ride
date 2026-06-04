import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel

from database import get_db
from redis_client import hold_slot, confirm_slot, release_slot, get_all_slot_statuses

router = APIRouter(prefix="/slots", tags=["slots"])

HOLD_DURATION_MINUTES = 15


# ----------------------------------------------------------------
# Response models
# ----------------------------------------------------------------

class SlotOut(BaseModel):
    id: int
    slot_code: str
    zone_id: int
    live_status: str   # from Redis: available / held:xxx / occupied:xxx

class HoldResponse(BaseModel):
    booking_id: str
    slot_id: int
    slot_code: str
    expires_at: str
    qr_token: str


# ----------------------------------------------------------------
# GET /slots — list all slots with live Redis status
# ----------------------------------------------------------------

@router.get("/", response_model=list[SlotOut])
async def list_slots(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT id, slot_code, zone_id FROM parking_slots ORDER BY zone_id, slot_code")
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


# ----------------------------------------------------------------
# POST /slots/{slot_id}/hold — hold a slot for 15 minutes
# ----------------------------------------------------------------

@router.post("/{slot_id}/hold", response_model=HoldResponse)
async def hold_slot_endpoint(slot_id: int, db: AsyncSession = Depends(get_db)):
    # 1. Verify slot exists
    result = await db.execute(
        text("SELECT id, slot_code FROM parking_slots WHERE id = :sid"),
        {"sid": slot_id}
    )
    slot = result.fetchone()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")

    # 2. Generate booking identifiers
    booking_id = str(uuid.uuid4())
    qr_token = str(uuid.uuid4())  # Phase 3 will sign this as JWT
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=HOLD_DURATION_MINUTES)

    # 3. Atomic Redis lock — prevents double-booking
    success = await hold_slot(slot_id, booking_id, ttl_seconds=HOLD_DURATION_MINUTES * 60)
    if not success:
        raise HTTPException(status_code=409, detail="Slot is no longer available")

    # 4. Persist booking record to PostgreSQL
    await db.execute(
        text("""
            INSERT INTO bookings (id, user_id, slot_id, status, qr_token, held_at, expires_at)
            VALUES (:id, :user_id, :slot_id, 'held', :qr_token, now(), :expires_at)
        """),
        {
            "id": booking_id,
            # Hardcoded placeholder user — Phase 3 will replace with real auth
            "user_id": "00000000-0000-0000-0000-000000000001",
            "slot_id": slot_id,
            "qr_token": qr_token,
            "expires_at": expires_at,
        }
    )
    await db.commit()

    return HoldResponse(
        booking_id=booking_id,
        slot_id=slot_id,
        slot_code=slot.slot_code,
        expires_at=expires_at.isoformat(),
        qr_token=qr_token,
    )


# ----------------------------------------------------------------
# DELETE /slots/{slot_id}/hold — release a hold
# ----------------------------------------------------------------

@router.delete("/{slot_id}/hold")
async def release_hold(slot_id: int, db: AsyncSession = Depends(get_db)):
    await release_slot(slot_id)

    await db.execute(
        text("""
            UPDATE bookings SET status = 'expired'
            WHERE slot_id = :sid AND status = 'held'
        """),
        {"sid": slot_id}
    )
    await db.commit()

    return {"message": f"Slot {slot_id} released successfully"}
