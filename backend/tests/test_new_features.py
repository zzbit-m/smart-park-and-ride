import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta

# Add parent dir to path so we can import services and routers
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException
from routers.auth import VerifyRequest
from services import slot_service


@pytest.mark.asyncio
@patch("routers.auth.get_redis")
async def test_otp_lockout_after_five_failed_attempts(mock_get_redis):
    # Mock Redis client
    mock_redis = AsyncMock()
    mock_redis.get.return_value = "1234"
    mock_get_redis.return_value = mock_redis

    mock_db = AsyncMock()
    
    from routers.auth import verify_otp
    body = VerifyRequest(phone="0812345678", otp="9999")
    
    # Simulate attempts count is 4, so on this call it will increment to 5
    async def mock_get_attempts(key):
        if key.endswith("otp_attempts:0812345678"):
            return "4"
        if key.endswith("otp:0812345678"):
            return "1234"
        return None
    mock_redis.get.side_effect = mock_get_attempts
    mock_redis.incr.return_value = 5

    # 5th attempt raises 429 and invalidates OTP
    with pytest.raises(HTTPException) as exc_info:
        await verify_otp(body, db=mock_db)
        
    assert exc_info.value.status_code == 429
    assert "Too many failed attempts" in exc_info.value.detail
    mock_redis.delete.assert_any_call("otp:0812345678")
    mock_redis.delete.assert_any_call("otp_attempts:0812345678")


@pytest.mark.asyncio
async def test_hold_slot_occupied_fails():
    mock_db = AsyncMock()
    
    # Mock user ban check returns no ban, duplicate check returns no duplicates, but slot query returns occupied status
    mock_user_ban = MagicMock()
    mock_user_ban.fetchone.return_value = None
    
    mock_dup_check = MagicMock()
    mock_dup_check.fetchone.return_value = None
    
    mock_slot_occupied = MagicMock()
    mock_slot_occupied.fetchone.return_value = MagicMock(id=1, slot_code="A01", last_known_status="occupied")
    
    mock_db.execute.side_effect = [mock_user_ban, mock_dup_check, mock_slot_occupied]
    
    with pytest.raises(HTTPException) as exc_info:
        await slot_service.hold_slot(
            db=mock_db,
            slot_id=1,
            license_plate="กข 1234",
            province="กรุงเทพมหานคร",
            user_id="00000000-0000-0000-0000-000000000002",
            actor="driver"
        )
        
    assert exc_info.value.status_code == 400
    assert "currently occupied" in exc_info.value.detail


@pytest.mark.asyncio
async def test_hold_slot_thai_plate_format():
    mock_db = AsyncMock()
    # Mock user ban check and duplicate check to return None
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    mock_db.execute.return_value = mock_result
    
    # 1. Invalid plate regex format (English characters)
    with pytest.raises(HTTPException) as exc_info:
        await slot_service.hold_slot(
            db=mock_db,
            slot_id=1,
            license_plate="AB 1234",
            province="กรุงเทพมหานคร",
            user_id="00000000-0000-0000-0000-000000000002",
            actor="driver"
        )
    assert exc_info.value.status_code == 422
    assert "Invalid Thai license plate format" in exc_info.value.detail

    # 2. Invalid digits count (5 digits)
    with pytest.raises(HTTPException) as exc_info:
        await slot_service.hold_slot(
            db=mock_db,
            slot_id=1,
            license_plate="กข 12345",
            province="กรุงเทพมหานคร",
            user_id="00000000-0000-0000-0000-000000000002",
            actor="driver"
        )
    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_hold_slot_duplicate_booking_fails():
    mock_db = AsyncMock()
    
    # Ban check returns no ban
    mock_result_ban = MagicMock()
    mock_result_ban.fetchone.return_value = None
    
    # Duplicate check returns a duplicate booking
    mock_result_dup = MagicMock()
    mock_result_dup.fetchone.return_value = MagicMock(id="some-id")
    
    mock_db.execute.side_effect = [mock_result_ban, mock_result_dup]
    
    with pytest.raises(HTTPException) as exc_info:
        await slot_service.hold_slot(
            db=mock_db,
            slot_id=1,
            license_plate="กข 1234",
            province="กรุงเทพมหานคร",
            user_id="00000000-0000-0000-0000-000000000002",
            actor="driver"
        )
    assert exc_info.value.status_code == 400
    assert "active reservation" in exc_info.value.detail


@pytest.mark.asyncio
async def test_hold_slot_banned_user_fails():
    mock_db = AsyncMock()
    
    # Mock user query returning future banned_until timestamp
    future_ban = datetime.now(timezone.utc) + timedelta(hours=10)
    mock_result_ban = MagicMock()
    mock_result_ban.fetchone.return_value = MagicMock(banned_until=future_ban)
    
    mock_db.execute.return_value = mock_result_ban
    
    with pytest.raises(HTTPException) as exc_info:
        await slot_service.hold_slot(
            db=mock_db,
            slot_id=1,
            license_plate="กข 1234",
            province="กรุงเทพมหานคร",
            user_id="00000000-0000-0000-0000-000000000002",
            actor="driver"
        )
        
    assert exc_info.value.status_code == 403
    assert "temporarily banned" in exc_info.value.detail
