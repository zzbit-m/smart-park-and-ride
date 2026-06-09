import logging
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.jwt_helper import decode_access_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["users"])

class VehicleOut(BaseModel):
    id: int
    license_plate: str
    province: str


async def verify_user_token(authorization: str = Header(default="")) -> dict:
    """FastAPI dependency to extract and validate the Bearer token for user endpoints."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header (expected: Bearer <token>)",
        )
    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


@router.get("/vehicles", response_model=list[VehicleOut])
async def list_user_vehicles(
    auth_payload: dict = Depends(verify_user_token),
    db: AsyncSession = Depends(get_db)
):
    user_id = auth_payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
        
    result = await db.execute(
        text("SELECT id, license_plate, province FROM user_vehicles WHERE user_id = :uid ORDER BY created_at DESC"),
        {"uid": user_id}
    )
    rows = result.fetchall()
    return [
        VehicleOut(id=row.id, license_plate=row.license_plate, province=row.province)
        for row in rows
    ]


@router.delete("/vehicles/{vehicle_id}")
async def delete_user_vehicle(
    vehicle_id: int,
    auth_payload: dict = Depends(verify_user_token),
    db: AsyncSession = Depends(get_db)
):
    user_id = auth_payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
        
    # Check if vehicle exists and belongs to this user
    result = await db.execute(
        text("SELECT id FROM user_vehicles WHERE id = :vid AND user_id = :uid LIMIT 1"),
        {"vid": vehicle_id, "uid": user_id}
    )
    vehicle = result.fetchone()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found or does not belong to you")
        
    await db.execute(
        text("DELETE FROM user_vehicles WHERE id = :vid"),
        {"vid": vehicle_id}
    )
    await db.commit()
    return {"message": "Vehicle deleted successfully"}
