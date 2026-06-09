import logging
import secrets
import uuid
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, get_redis
from services.jwt_helper import create_access_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

class OTPRequest(BaseModel):
    phone: str = Field(..., min_length=9, max_length=15, pattern=r"^\+?\d+$")

class OTPResponse(BaseModel):
    message: str
    debug_otp: str | None = None

class VerifyRequest(BaseModel):
    phone: str = Field(..., min_length=9, max_length=15, pattern=r"^\+?\d+$")
    otp: str = Field(..., min_length=4, max_length=4, pattern=r"^\d{4}$")

class VerifyResponse(BaseModel):
    token: str
    user_id: str
    display_name: str | None = None


@router.post("/otp", response_model=OTPResponse)
async def request_otp(body: OTPRequest):
    phone = body.phone.strip()
    
    # Generate 4 digit OTP cryptographically securely
    otp = f"{secrets.randbelow(9000) + 1000}"
    
    # Save in Redis with key otp:{phone} and TTL 300 seconds
    redis_client = get_redis()
    await redis_client.set(f"otp:{phone}", otp, ex=300)
    # Clear any previous failed attempts count for this phone
    await redis_client.delete(f"otp_attempts:{phone}")
    
    logger.info(f"[OTP] Generated secure OTP for phone {phone}")
    
    is_production = os.getenv("ENV", "").lower() == "production"
    
    return OTPResponse(
        message="OTP sent successfully",
        debug_otp=None if is_production else otp
    )


@router.post("/verify", response_model=VerifyResponse)
async def verify_otp(body: VerifyRequest, db: AsyncSession = Depends(get_db)):
    phone = body.phone.strip()
    otp = body.otp.strip()
    
    redis_client = get_redis()
    
    # Check if locked out (already hit limit)
    attempts_val = await redis_client.get(f"otp_attempts:{phone}")
    if attempts_val and int(attempts_val) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Please request a new OTP."
        )

    stored_otp = await redis_client.get(f"otp:{phone}")
    
    if not stored_otp:
        raise HTTPException(status_code=400, detail="OTP expired or not found")
        
    if stored_otp != otp:
        # Increment attempt counter
        attempts = await redis_client.incr(f"otp_attempts:{phone}")
        if attempts == 1:
            await redis_client.expire(f"otp_attempts:{phone}", 300)
            
        if attempts >= 5:
            # Delete OTP and clear attempts
            await redis_client.delete(f"otp:{phone}")
            await redis_client.delete(f"otp_attempts:{phone}")
            raise HTTPException(
                status_code=429,
                detail="Too many failed attempts. This OTP has been invalidated. Please request a new OTP."
            )
            
        raise HTTPException(
            status_code=400,
            detail=f"Invalid OTP code. {5 - attempts} attempts remaining."
        )
        
    # Delete OTP and lockout counter after successful verification
    await redis_client.delete(f"otp:{phone}")
    await redis_client.delete(f"otp_attempts:{phone}")
    
    # Check if user exists in DB
    result = await db.execute(
        text("SELECT id, display_name FROM users WHERE phone = :phone LIMIT 1"),
        {"phone": phone}
    )
    user = result.fetchone()
    
    if user:
        user_id = str(user.id)
        display_name = user.display_name
    else:
        # Create user
        user_id = str(uuid.uuid4())
        display_name = f"User {phone[-4:]}"
        await db.execute(
            text("""
                INSERT INTO users (id, phone, display_name, role)
                VALUES (:id, :phone, :display_name, 'user')
            """),
            {"id": user_id, "phone": phone, "display_name": display_name}
        )
        await db.commit()
        
    # Create JWT token for user
    token = create_access_token({"sub": user_id, "role": "user"})
    
    return VerifyResponse(
        token=token,
        user_id=user_id,
        display_name=display_name
    )
