from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from database import check_postgres, check_redis, close_connections, init_connections


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_connections()
    yield
    await close_connections()


app = FastAPI(
    title="Smart Park & Ride API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health(response: Response):
    """
    Verify PostgreSQL and Redis are reachable.
    Returns HTTP 200 when both are healthy, 503 otherwise.
    """
    postgres_ok = False
    redis_ok = False
    postgres_error: str | None = None
    redis_error: str | None = None

    try:
        postgres_ok = await check_postgres()
    except Exception as exc:
        postgres_error = str(exc)

    try:
        redis_ok = await check_redis()
    except Exception as exc:
        redis_error = str(exc)

    healthy = postgres_ok and redis_ok
    if not healthy:
        response.status_code = 503

    return {
        "status": "ok" if healthy else "degraded",
        "postgres": {"ok": postgres_ok, "error": postgres_error},
        "redis": {"ok": redis_ok, "error": redis_error},
    }
