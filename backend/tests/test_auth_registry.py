import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException
from routers.auth import OTPRequest, VerifyRequest
from services.jwt_helper import decode_access_token


@pytest.mark.asyncio
@patch("routers.auth.get_redis")
@patch("routers.auth.settings")
async def test_request_otp(mock_settings, mock_get_redis):
    mock_settings.DEBUG_OTP = True
    # Mock Redis client
    mock_redis = AsyncMock()
    mock_get_redis.return_value = mock_redis
    
    from routers.auth import request_otp
    
    body = OTPRequest(phone="0812345678")
    response = await request_otp(body)
    
    # Assert OTP message is returned and saved in redis
    assert response.message == "OTP sent successfully"
    assert response.debug_otp is not None
    assert len(response.debug_otp) == 4
    
    mock_redis.set.assert_called_once()
    called_key = mock_redis.set.call_args[0][0]
    called_val = mock_redis.set.call_args[0][1]
    assert called_key == "otp:0812345678"
    assert called_val == response.debug_otp


@pytest.mark.asyncio
@patch("routers.auth.get_redis")
async def test_verify_otp_success_new_user(mock_get_redis):
    # Mock Redis
    mock_redis = AsyncMock()
    async def mock_get(key):
        if key.startswith("otp:"):
            return "1234"
        return None
    mock_redis.get.side_effect = mock_get
    mock_get_redis.return_value = mock_redis
    
    # Mock Database session
    mock_db = AsyncMock()
    # Mock select query returning no existing user
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    mock_db.execute.return_value = mock_result

    
    from routers.auth import verify_otp
    
    body = VerifyRequest(phone="0812345678", otp="1234")
    response = await verify_otp(body, db=mock_db)
    
    # Check JWT token returned and user ID created
    assert response.token is not None
    assert response.user_id is not None
    
    # Verify token payload
    payload = decode_access_token(response.token)
    assert payload is not None
    assert payload["sub"] == response.user_id
    assert payload["role"] == "user"
    
    # Check that database inserted the new user
    mock_db.execute.assert_called()
    mock_redis.delete.assert_called()


@pytest.mark.asyncio
@patch("routers.auth.get_redis")
async def test_verify_otp_invalid_code(mock_get_redis):
    mock_redis = AsyncMock()
    async def mock_get(key):
        if key.startswith("otp:"):
            return "1234"
        return None
    mock_redis.get.side_effect = mock_get
    mock_redis.incr.return_value = 1
    mock_get_redis.return_value = mock_redis
    
    mock_db = AsyncMock()
    
    from routers.auth import verify_otp
    
    body = VerifyRequest(phone="0812345678", otp="9999")
    
    with pytest.raises(HTTPException) as exc_info:
        await verify_otp(body, db=mock_db)
        
    assert exc_info.value.status_code == 400
    assert "Invalid OTP code" in exc_info.value.detail
