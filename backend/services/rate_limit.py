import logging
from fastapi import HTTPException, Request

from database import get_redis
from config import settings
from services.jwt_helper import decode_access_token

logger = logging.getLogger(__name__)

# Atomic Lua script for rate limiting (INCR + EXPIRE on count == 1)
LUA_RATE_LIMIT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


def get_client_ip(request: Request) -> str:
    """Resolve the client's IP address, checking X-Forwarded-For if behind a trusted proxy."""
    if settings.TRUST_PROXY:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # Take the first IP if there is a chain of proxies
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown-ip"


async def check_rate_limit(identifier: str, endpoint: str, limit: int, window_seconds: int) -> None:
    """
    Atomically check and increment rate limit count in Redis using Lua script.
    Raises HTTPException(429) if the limit is exceeded.
    """
    redis = get_redis()
    key = f"ratelimit:{endpoint}:{identifier}"
    
    try:
        # Execute atomic Lua script
        result = await redis.eval(LUA_RATE_LIMIT, 1, key, str(window_seconds))
        count = int(result)
            
        if count > limit:
            logger.warning(f"Rate limit exceeded on '{endpoint}' for identifier '{identifier}' ({count}/{limit})")
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again later."
            )
    except HTTPException:
        raise
    except Exception as e:
        # Log and allow request if Redis fails (fail-open strategy for rate limiting)
        logger.error(f"Redis rate limiting failed: {e}", exc_info=True)
        return


class RateLimiter:
    """FastAPI dependency to enforce Redis-backed rate limits on routes."""
    def __init__(self, endpoint: str, limit: int, window_seconds: int):
        self.endpoint = endpoint
        self.limit = limit
        self.window_seconds = window_seconds

    async def __call__(self, request: Request) -> None:
        # Resolve authentication payload if present
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.removeprefix("Bearer ").strip()
            payload = decode_access_token(token)
            if payload:
                role = payload.get("role")
                if role in ["admin", "operator"]:
                    logger.debug(f"Bypassing rate limit on '{self.endpoint}' for staff user '{payload.get('sub')}'")
                    return
                
                user_id = payload.get("sub")
                if user_id:
                    await check_rate_limit(f"user:{user_id}", self.endpoint, self.limit, self.window_seconds)
                    return

        ip = get_client_ip(request)
        await check_rate_limit(f"ip:{ip}", self.endpoint, self.limit, self.window_seconds)
