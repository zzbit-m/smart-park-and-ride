from database import get_redis

HOLD_TTL_SECONDS = 900  # 15 minutes


def get_slot_key(slot_id: int) -> str:
    return f"slot:status:{slot_id}"


def get_qr_key(qr_token: str) -> str:
    return f"qr:{qr_token}"


# Atomic hold: SET only if missing or "available" (prevents double-booking).
# Returns 1 on success, 0 if slot is already held or occupied.
HOLD_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if current == false or current == 'available' then
    redis.call('SET', KEYS[1], 'held:' .. ARGV[1], 'EX', ARGV[2])
    return 1
else
    return 0
end
"""


async def hold_slot(
    slot_id: int,
    booking_id: str,
    ttl_seconds: int = HOLD_TTL_SECONDS,
) -> bool:
    """
    Atomically hold a slot in Redis for up to ttl_seconds (default 15 min).
    Value stored: held:{booking_id}
    Returns True if the lock was acquired, False if already taken.
    """
    redis = get_redis()
    key = get_slot_key(slot_id)
    result = await redis.eval(HOLD_SCRIPT, 1, key, booking_id, str(ttl_seconds))
    return result == 1


async def set_qr_token_lookup(
    qr_token: str,
    slot_id: int,
    ttl_seconds: int = HOLD_TTL_SECONDS,
) -> None:
    """Map qr_token -> slot_id (same 15-minute TTL as the hold)."""
    redis = get_redis()
    await redis.set(get_qr_key(qr_token), str(slot_id), ex=ttl_seconds)


async def get_slot_id_by_qr_token(qr_token: str) -> int | None:
    """Return slot_id for an active QR token, or None if missing/expired."""
    redis = get_redis()
    value = await redis.get(get_qr_key(qr_token))
    if value is None:
        return None
    return int(value)


async def delete_qr_token_lookup(qr_token: str) -> None:
    redis = get_redis()
    await redis.delete(get_qr_key(qr_token))


async def delete_slot_hold(slot_id: int) -> None:
    """Remove the slot status key (clears hold / live Redis state for this slot)."""
    redis = get_redis()
    await redis.delete(get_slot_key(slot_id))


async def get_slot_status(slot_id: int) -> str:
    """Return raw Redis value for one slot ('available' if unset)."""
    redis = get_redis()
    value = await redis.get(get_slot_key(slot_id))
    return value if value else "available"


async def get_all_slot_statuses(slot_ids: list[int]) -> dict[int, str]:
    """Batch-fetch live status for all given slot IDs."""
    if not slot_ids:
        return {}

    redis = get_redis()
    keys = [get_slot_key(sid) for sid in slot_ids]
    values = await redis.mget(*keys)
    return {
        sid: (val if val else "available")
        for sid, val in zip(slot_ids, values)
    }


async def release_slot(slot_id: int) -> None:
    """Return a slot to available (e.g. cancel hold)."""
    redis = get_redis()
    await redis.set(get_slot_key(slot_id), "available")


async def occupy_slot(slot_id: int, booking_id: str) -> None:
    """Mark a slot occupied in Redis (without TTL, representing parked state)."""
    redis = get_redis()
    await redis.set(get_slot_key(slot_id), f"occupied:{booking_id}")
