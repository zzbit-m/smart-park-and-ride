"""
Mock Tram router — Phase 8 presentation stub.
Returns static data; no database queries.
Real hardware integration will replace this in Phase 9.
"""
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/trams", tags=["trams 🚃"])


# ── Response models ───────────────────────────────────────────────────────────

class TramEntry(BaseModel):
    id: int
    line: str
    line_color: str
    next_arrival: str
    destination: str
    status: Literal["กำลังมา", "ปกติ", "ล่าช้า", "หยุดให้บริการ"]
    platform: str


class LiveTramsResponse(BaseModel):
    source: str
    updated_at: str
    trams: list[TramEntry]


# ── Static mock data ──────────────────────────────────────────────────────────

_MOCK_TRAMS: list[dict] = [
    {
        "id": 1,
        "line": "สายสีน้ำเงิน",
        "line_color": "#3d8bff",
        "next_arrival": "3 นาที",
        "destination": "สถานีกลาง",
        "status": "กำลังมา",
        "platform": "ชานชาลา A",
    },
    {
        "id": 2,
        "line": "สายสีแดง",
        "line_color": "#ff4d6d",
        "next_arrival": "12 นาที",
        "destination": "ท่ารถโดยสาร",
        "status": "ปกติ",
        "platform": "ชานชาลา B",
    },
    {
        "id": 3,
        "line": "สายสีเขียว",
        "line_color": "#00e5a0",
        "next_arrival": "24 นาที",
        "destination": "อาคาร C / ศูนย์การค้า",
        "status": "ปกติ",
        "platform": "ชานชาลา A",
    },
]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get(
    "/live",
    response_model=LiveTramsResponse,
    summary="Live tram arrivals (mock)",
    description="""
Returns upcoming tram arrivals for the Smart Park & Ride station.

> ⚠️ **Phase 8 — Mock Data**  
> This endpoint currently returns static demo data for presentation purposes.  
> Real-time data will be populated by the tram hardware integration in Phase 9.

### Fields
| Field | Description |
|---|---|
| `line` | Tram line name (Thai) |
| `line_color` | Hex color for UI rendering |
| `next_arrival` | Human-readable ETA |
| `status` | `กำลังมา` / `ปกติ` / `ล่าช้า` / `หยุดให้บริการ` |
| `platform` | Boarding platform label |
""",
)
async def get_live_trams() -> LiveTramsResponse:
    """
    Simulate real-time tram arrival board for the Park & Ride station.
    Returns static mock entries; replace with live hardware feed in Phase 9.
    """
    from datetime import datetime, timezone
    return LiveTramsResponse(
        source="mock — Phase 8 demo",
        updated_at=datetime.now(timezone.utc).isoformat(),
        trams=[TramEntry(**t) for t in _MOCK_TRAMS],
    )
