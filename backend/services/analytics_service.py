from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from repositories.analytics_repo import (
    daily_summary_stats,
    hourly_distribution,
    slot_utilization,
    total_slots_available,
)

RANGE_LABELS = {
    "day": "Daily",
    "week": "Weekly",
    "month": "Monthly",
}


def _compute_date_range(target_date: date, range_type: str) -> tuple[date, date, str]:
    if range_type == "day":
        return target_date, target_date, target_date.isoformat()

    if range_type == "week":
        start = target_date - timedelta(days=target_date.weekday())
        end = start + timedelta(days=6)
        label = f"{start.isoformat()} — {end.isoformat()}"
        return start, end, label

    if range_type == "month":
        start = target_date.replace(day=1)
        if target_date.month == 12:
            end = target_date.replace(year=target_date.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            end = target_date.replace(month=target_date.month + 1, day=1) - timedelta(days=1)
        label = target_date.strftime("%Y-%m")
        return start, end, label

    raise ValueError(f"Unknown range_type: {range_type}")


async def get_export_summary(db: AsyncSession, target_date: date, range_type: str = "day") -> dict:
    date_from, date_to, date_label = _compute_date_range(target_date, range_type)

    daily = await daily_summary_stats(db, date_from, date_to)
    total_slots = await total_slots_available(db)

    occupancy_rate = round(daily["used_slots"] / total_slots, 4) if total_slots > 0 else 0.0

    hourly = await hourly_distribution(db, date_from, date_to)

    peak_hour = {"hour": 0, "count": 0}
    if hourly:
        peak_hour = max(hourly, key=lambda x: x["count"])

    utilization = await slot_utilization(db, date_from, date_to)

    return {
        "range": RANGE_LABELS.get(range_type, "Daily"),
        "date": date_label,
        "total_cars": daily["total_cars"],
        "average_duration_minutes": daily["avg_minutes"],
        "occupancy_rate": occupancy_rate,
        "peak_hour": peak_hour,
        "hourly_distribution": hourly,
        "slot_utilization": utilization,
    }
