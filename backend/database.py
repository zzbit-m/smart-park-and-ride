import os
from typing import AsyncGenerator, Optional

from redis.asyncio import ConnectionPool, Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://parking_user:parking_pass@localhost:5432/parking_db",
)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

engine = create_async_engine(DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

redis_pool: Optional[ConnectionPool] = None
redis_client: Optional[Redis] = None


class Base(DeclarativeBase):
    pass


async def init_connections() -> None:
    """Create the Redis connection pool and client (call at app startup)."""
    global redis_pool, redis_client
    redis_pool = ConnectionPool.from_url(REDIS_URL, decode_responses=True)
    redis_client = Redis(connection_pool=redis_pool)


async def close_connections() -> None:
    """Release Redis and PostgreSQL resources (call at app shutdown)."""
    global redis_pool, redis_client

    if redis_client is not None:
        await redis_client.aclose()
        redis_client = None

    if redis_pool is not None:
        await redis_pool.disconnect()
        redis_pool = None

    await engine.dispose()


async def check_postgres() -> bool:
    """Return True if PostgreSQL accepts a simple query."""
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
    return True


async def check_redis() -> bool:
    """Return True if Redis responds to PING."""
    if redis_client is None:
        return False
    return await redis_client.ping()


def get_redis() -> Redis:
    """Return the shared Redis client (requires init_connections at startup)."""
    if redis_client is None:
        raise RuntimeError("Redis is not initialized. Call init_connections() first.")
    return redis_client


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async database session."""
    async with AsyncSessionLocal() as session:
        yield session
