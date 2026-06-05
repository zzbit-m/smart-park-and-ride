from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from database import check_postgres, check_redis, close_connections, init_connections
from auto_seed import auto_seed
from routers import admin, slots, trams

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allowed origins are read from the environment (comma-separated).
# For local development the defaults below cover VS Code Live Server (5500)
# and direct backend access.
# In production, set CORS_ALLOWED_ORIGINS to your real frontend domain:
#   CORS_ALLOWED_ORIGINS=https://your-app.example.com
_raw_origins = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5173,http://127.0.0.1:5173",
)
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]




@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_connections()
    await auto_seed()   # no-op when parking_slots already has rows
    yield
    await close_connections()


app = FastAPI(
    title="Smart Park & Ride API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


app.include_router(admin.router, prefix="/api")
app.include_router(slots.router, prefix="/api")
app.include_router(trams.router, prefix="/api")


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
