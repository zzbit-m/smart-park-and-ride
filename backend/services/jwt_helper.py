import base64
import hashlib
import hmac
import json
import time

from config import settings

def _base64url_encode(data: bytes) -> str:
    """Encode bytes to a base64url string without padding."""
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


def _base64url_decode(data: str) -> bytes:
    """Decode a base64url string, adding padding back if necessary."""
    rem = len(data) % 4
    if rem > 0:
        data += '=' * (4 - rem)
    return base64.urlsafe_b64decode(data)


def create_access_token(payload: dict, expires_in_seconds: int = 3600) -> str:
    """
    Generate a signed HS256 JWT access token.
    Appends an 'exp' claim computed from the current time.
    """
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _base64url_encode(json.dumps(header).encode('utf-8'))
    
    # Copy payload to prevent side-effects, and add expiration
    payload_copy = payload.copy()
    payload_copy["exp"] = int(time.time()) + expires_in_seconds
    
    payload_b64 = _base64url_encode(json.dumps(payload_copy).encode('utf-8'))
    
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    signature = hmac.new(
        settings.JWT_SECRET.encode('utf-8'),
        signing_input,
        hashlib.sha256
    ).digest()
    signature_b64 = _base64url_encode(signature)
    
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def decode_access_token(token: str) -> dict | None:
    """
    Verify and decode an HS256 JWT access token.
    Validates the signature and checks the 'exp' claim.
    Returns the payload dict if valid, or None if invalid or expired.
    """
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
            
        header_b64, payload_b64, signature_b64 = parts
        
        # Verify signature in constant time to prevent timing attacks
        signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
        expected_signature = hmac.new(
            settings.JWT_SECRET.encode('utf-8'),
            signing_input,
            hashlib.sha256
        ).digest()
        expected_signature_b64 = _base64url_encode(expected_signature)
        
        if not hmac.compare_digest(signature_b64, expected_signature_b64):
            return None
            
        # Decode and load payload
        payload = json.loads(_base64url_decode(payload_b64).decode('utf-8'))
        
        # Verify expiration
        exp = payload.get("exp")
        if exp is None or exp < time.time():
            return None
            
        return payload
    except Exception:
        return None
