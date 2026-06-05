"""
auto_seed.py — Idempotent startup seeder.

Called once from the FastAPI lifespan (after init_connections) to ensure the
database has at least the default parking zones, placeholder user, and parking
slots (A01–A10, B01–B10) ready to serve.

The check is a single COUNT(*) on parking_slots; if any rows exist the seeder
exits immediately so normal restarts are effectively a no-op.
"""

import logging

from sqlalchemy import text

from database import AsyncSessionLocal
from redis_client import get_redis, get_slot_key

logger = logging.getLogger(__name__)

PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001"

# (zone_name, tram_stop, slot_code) — zero-padded slot codes
_SEED_DATA: list[tuple[str, str, str]] = (
    [("Zone A", "Tram Stop A", f"A{i:02d}") for i in range(1, 11)]
    + [("Zone B", "Tram Stop B", f"B{i:02d}") for i in range(1, 11)]
)


async def auto_seed() -> None:
    """
    Seed zones, placeholder user, and parking slots if the table is empty.
    Safe to call on every startup — exits immediately when data already exists.
    """
    async with AsyncSessionLocal() as db:
        # ── Guard: skip entirely if any slot already exists ──────────────────
        result = await db.execute(text("SELECT COUNT(*) FROM parking_slots"))
        count = result.scalar_one()
        if count > 0:
            logger.info("[seed] parking_slots has %d rows — skipping auto-seed.", count)
            return

        logger.info("[seed] parking_slots is empty — running auto-seed …")

        # ── 1. Ensure placeholder user exists ────────────────────────────────
        await db.execute(
            text("""
                INSERT INTO users (id, phone, display_name, role)
                VALUES (:id, '0000000000', 'Dev User', 'user')
                ON CONFLICT (id) DO NOTHING
            """),
            {"id": PLACEHOLDER_USER_ID},
        )

        # ── 2. Upsert zones and collect their IDs ────────────────────────────
        zone_ids: dict[str, int] = {}
        for zone_name, tram_stop, _ in _SEED_DATA:
            if zone_name in zone_ids:
                continue

            # Try to find an existing zone first
            row = (await db.execute(
                text("SELECT id FROM parking_zones WHERE name = :name"),
                {"name": zone_name},
            )).fetchone()

            if row:
                zone_ids[zone_name] = row.id
            else:
                row = (await db.execute(
                    text("""
                        INSERT INTO parking_zones (name, tram_stop, total_slots)
                        VALUES (:name, :tram_stop, 10)
                        RETURNING id
                    """),
                    {"name": zone_name, "tram_stop": tram_stop},
                )).fetchone()
                zone_ids[zone_name] = row.id

        # ── 3. Insert slots (idempotent via ON CONFLICT DO NOTHING) ──────────
        slots_created: list[tuple[int, str]] = []   # [(slot_id, slot_code)]
        for zone_name, _, slot_code in _SEED_DATA:
            row = (await db.execute(
                text("""
                    INSERT INTO parking_slots (zone_id, slot_code, last_known_status)
                    VALUES (:zone_id, :slot_code, 'available')
                    ON CONFLICT (slot_code) DO NOTHING
                    RETURNING id
                """),
                {"zone_id": zone_ids[zone_name], "slot_code": slot_code},
            )).fetchone()

            if row:
                slots_created.append((row.id, slot_code))

        await db.commit()

        # ── 4. Initialise Redis keys for every new slot ───────────────────────
        redis = get_redis()
        for slot_id, slot_code in slots_created:
            await redis.set(get_slot_key(slot_id), "available")

        logger.info(
            "[seed] Auto-seed complete — %d slots created: %s",
            len(slots_created),
            ", ".join(code for _, code in slots_created),
        )
