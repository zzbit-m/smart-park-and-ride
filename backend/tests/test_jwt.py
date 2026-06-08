import sys
import os
import time

# Add parent dir to path so we can import services
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.jwt_helper import create_access_token, decode_access_token


def test_create_and_decode_token():
    payload = {"sub": "operator", "role": "operator"}
    # Token valid for 5 seconds
    token = create_access_token(payload, expires_in_seconds=5)
    
    decoded = decode_access_token(token)
    assert decoded is not None
    assert decoded["sub"] == "operator"
    assert decoded["role"] == "operator"
    assert "exp" in decoded


def test_token_expiration():
    payload = {"sub": "admin", "role": "admin"}
    # Generate an expired token
    token = create_access_token(payload, expires_in_seconds=-10)
    
    decoded = decode_access_token(token)
    assert decoded is None


def test_token_tampered():
    payload = {"sub": "admin", "role": "admin"}
    token = create_access_token(payload, expires_in_seconds=10)
    
    # Tamper with the signature signature
    parts = token.split(".")
    assert len(parts) == 3
    parts[2] = parts[2] + "xyz"
    tampered_token = ".".join(parts)
    
    decoded = decode_access_token(tampered_token)
    assert decoded is None


def test_invalid_token_format():
    assert decode_access_token("not-a-token") is None
    assert decode_access_token("a.b") is None
    assert decode_access_token("a.b.c.d") is None
