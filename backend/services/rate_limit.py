import logging
from fastapi import HTTPException, Request

from database import get_redis

logger = logging.getLogger(__name__)

def get_client_ip(request: Request) -> str:
    """Resolve the client's IP address, checking X-Forwarded-For if behind a proxy."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Take the first IP if there is a chain of proxies
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown-ip"


async def check_rate_limit(identifier: str, endpoint: str, limit: int, window_seconds: int) -> None:
    """
    Atomically check and increment rate limit count in Redis.
    Raises HTTPException(429) if the limit is exceeded.
    """
    redis = get_redis()
    key = f"ratelimit:{endpoint}:{identifier}"
    
    try:
        # Atomic increment
        count = await redis.incr(key)
        if count == 1:
            # Set window TTL for a newly created key
            await redis.expire(key, window_seconds)
            
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
        ip = get_client_ip(request)
        await check_rate_limit(ip, self.endpoint, self.limit, self.window_seconds)
