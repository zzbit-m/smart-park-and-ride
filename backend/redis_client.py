import os
import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Shared Redis client (created once at startup)
redis_client: aioredis.Redis = None

async def init_redis():
    global redis_client
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)

async def close_redis():
    if redis_client:
        await redis_client.aclose()

def get_slot_key(slot_id: int) -> str:
    return f"slot:status:{slot_id}"

# ----------------------------------------------------------------
# Lua script — atomic hold operation (prevents double-booking)
# Returns 1 on success, 0 if slot is already taken
# ----------------------------------------------------------------
HOLD_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if current == false or current == 'available' then
    redis.call('SET', KEYS[1], 'held:' .. ARGV[1], 'EX', ARGV[2])
    return 1
else
    return 0
end
"""

async def hold_slot(slot_id: int, booking_id: str, ttl_seconds: int = 900) -> bool:
    """
    Atomically set a slot to held state.
    Returns True if successful, False if already taken.
    """
    key = get_slot_key(slot_id)
    result = await redis_client.eval(HOLD_SCRIPT, 1, key, booking_id, ttl_seconds)
    return result == 1

async def confirm_slot(slot_id: int, booking_id: str) -> None:
    """Mark slot as occupied after user scans in at the gate."""
    key = get_slot_key(slot_id)
    await redis_client.set(key, f"occupied:{booking_id}")  # no TTL

async def release_slot(slot_id: int) -> None:
    """Return slot to available (scan out, or hold expired)."""
    key = get_slot_key(slot_id)
    await redis_client.set(key, "available")

async def get_slot_status(slot_id: int) -> str:
    """Get raw Redis value for a slot. Returns 'available' if key missing."""
    key = get_slot_key(slot_id)
    value = await redis_client.get(key)
    return value if value else "available"

async def get_all_slot_statuses(slot_ids: list[int]) -> dict[int, str]:
    """Batch fetch statuses for multiple slots."""
    if not slot_ids:
        return {}
    keys = [get_slot_key(sid) for sid in slot_ids]
    values = await redis_client.mget(*keys)
    return {
        sid: (val if val else "available")
        for sid, val in zip(slot_ids, values)
    }
