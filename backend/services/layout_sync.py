import json
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from redis_client import get_redis, get_slot_key
from services.audit import log_audit

logger = logging.getLogger(__name__)


def _validate_config(config: dict) -> None:
    if not isinstance(config, dict):
        raise ValueError("config must be a dict")
    if not isinstance(config.get("version"), int):
        raise ValueError("config.version is required and must be an integer")
    if not isinstance(config.get("label"), str) or not config["label"].strip():
        raise ValueError("config.label is required and must be a non-empty string")
    zones = config.get("zones")
    if not isinstance(zones, list) or len(zones) == 0:
        raise ValueError("config.zones is required and must be a non-empty list")
    for i, zone in enumerate(zones):
        if not isinstance(zone, dict):
            raise ValueError(f"zones[{i}] must be a dict")
        for key in ("zone_name", "rows", "cols", "slot_prefix"):
            if key not in zone:
                raise ValueError(f"zones[{i}] is missing required field '{key}'")


def _generate_slot_code(prefix: str, rows: int, cols: int, row: int, col: int) -> str:
    if rows == 1 and cols <= 10:
        return f"{prefix}{col:02d}"
    return f"{prefix}{row:02d}-{col:02d}"


def _build_slot_codes(config: dict) -> list[dict]:
    slots: list[dict] = []
    for zone in config["zones"]:
        prefix = zone["slot_prefix"]
        rows = zone["rows"]
        cols = zone["cols"]
        zone_name = zone["zone_name"]

        overrides: dict[tuple[int, int], str] = {}
        for ov in zone.get("overrides", []):
            overrides[(ov["row"], ov["col"])] = ov["slot_type"]

        for r in range(1, rows + 1):
            for c in range(1, cols + 1):
                slot_code = _generate_slot_code(prefix, rows, cols, r, c)

                raw_type = overrides.get((r, c), zone.get("slot_type", "standard"))
                slot_type = raw_type.lower() if isinstance(raw_type, str) else "standard"

                slots.append({
                    "zone_name": zone_name,
                    "slot_code": slot_code,
                    "row_number": r,
                    "col_number": c,
                    "slot_type": slot_type,
                })
    return slots


async def _resolve_zone_id(db: AsyncSession, zone_name: str, total_slots: int) -> int:
    row = (await db.execute(
        text("SELECT id FROM parking_zones WHERE name = :name"),
        {"name": zone_name},
    )).fetchone()
    if row:
        return row[0]

    row = (await db.execute(
        text("""
            INSERT INTO parking_zones (name, tram_stop, total_slots)
            VALUES (:name, :name, :total_slots)
            RETURNING id
        """),
        {"name": zone_name, "total_slots": total_slots},
    )).fetchone()
    if row:
        return row[0]
    raise RuntimeError("Failed to resolve or create zone ID")


async def apply_layout(
    db: AsyncSession,
    config: dict,
    uploaded_by: str,
) -> dict:
    _validate_config(config)

    # ── Version guard ──────────────────────────────────────────────────────
    row = (await db.execute(
        text("SELECT version FROM parking_layouts WHERE is_active = TRUE LIMIT 1"),
    )).fetchone()
    current_version = row.version if row else None

    if current_version is not None and config["version"] <= current_version:
        raise RuntimeError(
            f"Layout version must be higher than current active version ({current_version})"
        )

    # ── Build new slot set ──────────────────────────────────────────────────
    new_slots = _build_slot_codes(config)
    new_codes = {s["slot_code"] for s in new_slots}
    zone_names = {s["zone_name"] for s in new_slots}

    # ── Preload existing slots ──────────────────────────────────────────────
    rows = (await db.execute(
        text("SELECT slot_code, id FROM parking_slots"),
    )).fetchall()
    existing_slots: dict[str, int] = {r.slot_code: r.id for r in rows}

    # ── Get currently active codes & compute removed set ────────────────────
    rows = (await db.execute(
        text("SELECT slot_code FROM parking_slots WHERE slot_status = 'active'"),
    )).fetchall()
    active_codes = {r.slot_code for r in rows}
    removed_codes = active_codes - new_codes

    # ── Conflict check ─────────────────────────────────────────────────────
    conflicts: list[dict] = []
    if removed_codes:
        conflict_rows = (await db.execute(
            text("""
                SELECT DISTINCT ps.slot_code
                FROM bookings b
                JOIN parking_slots ps ON ps.id = b.slot_id
                WHERE ps.slot_code = ANY(:codes)
                  AND b.status IN ('held', 'confirmed')
            """),
            {"codes": list(removed_codes)},
        )).fetchall()

        for cr in conflict_rows:
            conflicts.append({
                "slot_code": cr.slot_code,
                "active_bookings": True,
            })

    if conflicts:
        return {
            "layout_id": None,
            "version": config["version"],
            "zones": len(zone_names),
            "slots_created": 0,
            "slots_unchanged": 0,
            "slots_removed": 0,
            "conflicts": conflicts,
        }

    # ── Zone info lookup for total_slots ────────────────────────────────────
    zone_info = {z["zone_name"]: z for z in config["zones"]}

    # ── Transaction ─────────────────────────────────────────────────────────
    try:

        # ── Insert layout row ───────────────────────────────────────────────
        row = (await db.execute(
            text("""
                INSERT INTO parking_layouts (version, label, config, uploaded_by)
                VALUES (:version, :label, CAST(:config_json AS jsonb), :uploaded_by)
                RETURNING id
            """),
            {
                "version": config["version"],
                "label": config["label"],
                "config_json": json.dumps(config),
                "uploaded_by": uploaded_by,
            },
        )).fetchone()
        if not row:
            raise RuntimeError("Failed to insert layout")
        layout_id = row[0]

        # ── Process slots ──────────────────────────────────────────────────
        slots_created = 0
        slots_unchanged = 0
        newly_created_ids: list[int] = []
        zone_cache: dict[str, int] = {}

        for slot in new_slots:
            zone_name = slot["zone_name"]
            if zone_name not in zone_cache:
                info = zone_info[zone_name]
                total_slots = info["rows"] * info["cols"]
                zone_id = await _resolve_zone_id(db, zone_name, total_slots)
                zone_cache[zone_name] = zone_id
            else:
                zone_id = zone_cache[zone_name]

            if slot["slot_code"] in existing_slots:
                await db.execute(
                    text("""
                        UPDATE parking_slots
                        SET slot_status = 'active', updated_at = now()
                        WHERE id = :sid
                    """),
                    {"sid": existing_slots[slot["slot_code"]]},
                )
                slots_unchanged += 1
            else:
                result = (await db.execute(
                    text("""
                        INSERT INTO parking_slots (zone_id, slot_code, last_known_status, slot_status)
                        VALUES (:zone_id, :code, 'available', 'active')
                        RETURNING id
                    """),
                    {"zone_id": zone_id, "code": slot["slot_code"]},
                )).fetchone()
                if not result:
                    raise RuntimeError("Failed to insert slot")
                newly_created_ids.append(result[0])
                slots_created += 1

        # ── Bulk upsert parking_layout_slots ────────────────────────────────
        if new_slots:
            value_clauses: list[str] = []
            params: dict[str, object] = {}
            for i, slot in enumerate(new_slots):
                p = f"l{i}"
                params.update({
                    f"{p}_lid": layout_id,
                    f"{p}_zn": slot["zone_name"],
                    f"{p}_sc": slot["slot_code"],
                    f"{p}_rn": slot["row_number"],
                    f"{p}_cn": slot["col_number"],
                    f"{p}_st": slot["slot_type"],
                })
                value_clauses.append(f"(:{p}_lid, :{p}_zn, :{p}_sc, :{p}_rn, :{p}_cn, :{p}_st)")

            await db.execute(
                text(f"""
                    INSERT INTO parking_layout_slots
                        (layout_id, zone_name, slot_code, row_number, col_number, slot_type)
                    VALUES {', '.join(value_clauses)}
                    ON CONFLICT (layout_id, zone_name, row_number, col_number) DO UPDATE
                        SET slot_code = EXCLUDED.slot_code,
                            slot_type = EXCLUDED.slot_type
                """),
                params,
            )

        # ── Mark removed slots ──────────────────────────────────────────────
        slots_removed = 0
        if removed_codes:
            result = await db.execute(
                text("""
                    UPDATE parking_slots
                    SET slot_status = 'removed', updated_at = now()
                    WHERE slot_code = ANY(:codes) AND slot_status = 'active'
                """),
                {"codes": list(removed_codes)},
            )
            raw = getattr(result, "rowcount", 0)
            slots_removed = raw if raw is not None and raw >= 0 else 0

        # ── Activate new layout ─────────────────────────────────────────────
        await db.execute(
            text("""
                UPDATE parking_layouts
                SET is_active = FALSE
                WHERE is_active = TRUE AND id != :lid
            """),
            {"lid": layout_id},
        )
        await db.execute(
            text("""
                UPDATE parking_layouts
                SET is_active = TRUE, activated_at = now()
                WHERE id = :lid
            """),
            {"lid": layout_id},
        )

        await db.commit()

    except Exception:
        await db.rollback()
        raise

    # ── Redis sync for newly created slots ──────────────────────────────────
    if newly_created_ids:
        redis = get_redis()
        pipe = redis.pipeline()
        for sid in newly_created_ids:
            pipe.set(get_slot_key(sid), "available")
        await pipe.execute()

    # ── Audit ───────────────────────────────────────────────────────────────
    log_audit(uploaded_by, "apply_layout",
              f"Applied layout v{config['version']} '{config['label']}' — "
              f"{slots_created} created, {slots_unchanged} unchanged, {slots_removed} removed")

    return {
        "layout_id": layout_id,
        "version": config["version"],
        "zones": len(zone_names),
        "slots_created": slots_created,
        "slots_unchanged": slots_unchanged,
        "slots_removed": slots_removed,
        "conflicts": [],
    }


async def preview_diff(db: AsyncSession, config: dict) -> dict:
    _validate_config(config)

    row = (await db.execute(
        text("SELECT version FROM parking_layouts WHERE is_active = TRUE LIMIT 1"),
    )).fetchone()
    current_version = row.version if row else None
    if current_version is not None and config["version"] <= current_version:
        raise RuntimeError(
            f"Layout version must be higher than current active version ({current_version})"
        )

    new_slots = _build_slot_codes(config)
    new_codes = {s["slot_code"] for s in new_slots}

    rows = (await db.execute(text("SELECT slot_code FROM parking_slots"))).fetchall()
    existing_codes = {r.slot_code for r in rows}
    rows = (await db.execute(
        text("SELECT slot_code FROM parking_slots WHERE slot_status = 'active'"),
    )).fetchall()
    active_codes = {r.slot_code for r in rows}
    removed_codes = active_codes - new_codes

    conflicts: list[dict] = []
    if removed_codes:
        conflict_rows = (await db.execute(
            text("""
                SELECT DISTINCT ps.slot_code
                FROM bookings b
                JOIN parking_slots ps ON ps.id = b.slot_id
                WHERE ps.slot_code = ANY(:codes)
                  AND b.status IN ('held', 'confirmed')
            """),
            {"codes": list(removed_codes)},
        )).fetchall()
        for cr in conflict_rows:
            conflicts.append({"slot_code": cr.slot_code, "active_bookings": True})

    return {
        "slots_to_create": sorted(new_codes - existing_codes),
        "slots_to_remove": sorted(removed_codes),
        "conflicts": conflicts,
        "unchanged": len(new_codes & existing_codes),
        "dry_run": True,
    }
