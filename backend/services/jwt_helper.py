import logging
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from config import settings

logger = logging.getLogger(__name__)


def create_access_token(payload: dict, expires_in_seconds: int = 3600) -> str:
    to_encode = payload.copy()
    expire = datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None
