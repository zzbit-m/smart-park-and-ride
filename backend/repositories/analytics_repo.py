from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def daily_summary_stats(db: AsyncSession, date_from: date, date_to: date) -> dict:
    result = await db.execute(
        text("""
            SELECT
                COUNT(*)                                              AS total_cars,
                COALESCE(
                    AVG(EXTRACT(EPOCH FROM (checked_out_at - checked_in_at)) / 60.0),
                    0
                )                                                     AS avg_minutes,
                COUNT(DISTINCT slot_id)                               AS used_slots
            FROM bookings
            WHERE status = 'completed'
              AND checked_in_at  IS NOT NULL
              AND checked_out_at IS NOT NULL
              AND checked_out_at > checked_in_at
              AND (checked_in_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN :date_from AND :date_to
        """),
        {"date_from": date_from, "date_to": date_to},
    )
    row = result.fetchone()
    return {
        "total_cars": row.total_cars if row else 0,
        "avg_minutes": round(float(row.avg_minutes), 2) if row else 0.0,
        "used_slots": row.used_slots if row else 0,
    }


async def total_slots_available(db: AsyncSession) -> int:
    result = await db.execute(
        text("SELECT COALESCE(SUM(total_slots), 0) FROM parking_zones")
    )
    return result.scalar() or 0


async def hourly_distribution(db: AsyncSession, date_from: date, date_to: date) -> list[dict]:
    result = await db.execute(
        text("""
            SELECT
                EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'Asia/Bangkok')::int AS hour,
                COUNT(*) AS count
            FROM bookings
            WHERE status = 'completed'
              AND checked_in_at  IS NOT NULL
              AND checked_out_at IS NOT NULL
              AND checked_out_at > checked_in_at
              AND (checked_in_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN :date_from AND :date_to
            GROUP BY 1
            ORDER BY 1
        """),
        {"date_from": date_from, "date_to": date_to},
    )
    return [{"hour": row.hour, "count": row.count} for row in result.fetchall()]


async def slot_utilization(db: AsyncSession, date_from: date, date_to: date) -> list[dict]:
    result = await db.execute(
        text("""
            SELECT
                ps.slot_code AS slot_id,
                COUNT(*)     AS usage_count
            FROM bookings b
            JOIN parking_slots ps ON ps.id = b.slot_id
            WHERE b.status = 'completed'
              AND b.checked_in_at  IS NOT NULL
              AND b.checked_out_at IS NOT NULL
              AND b.checked_out_at > b.checked_in_at
              AND (b.checked_in_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN :date_from AND :date_to
            GROUP BY ps.slot_code
            ORDER BY usage_count DESC
        """),
        {"date_from": date_from, "date_to": date_to},
    )
    return [{"slot_id": row.slot_id, "usage_count": row.usage_count} for row in result.fetchall()]
