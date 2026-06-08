import asyncio
from contextlib import asynccontextmanager
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from database import check_postgres, check_redis, close_connections, init_connections
from auto_seed import auto_seed
from routers import admin, slots
from config import settings

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allowed origins are read from settings (comma-separated).
# For local development the defaults cover VS Code Live Server (5500)
# and direct backend access.
# In production, set CORS_ALLOWED_ORIGINS to your real frontend domain:
#   CORS_ALLOWED_ORIGINS=https://your-app.example.com
_raw_origins = settings.CORS_ALLOWED_ORIGINS
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]




from expiry_worker import run_expiry_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_connections()
    await auto_seed()   # no-op when parking_slots already has rows
    
    # Start background worker task
    worker_task = asyncio.create_task(run_expiry_worker())
    
    try:
        yield
    finally:
        # Cancel and wait for background worker
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass
        await close_connections()


app = FastAPI(
    title="Smart Park & Ride API",
    version="0.1.0",
    lifespan=lifespan,
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    errors = exc.errors()
    error_messages = []
    for err in errors:
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        msg = err.get("msg", "Invalid value")
        error_messages.append(f"{loc}: {msg}")
    detail_msg = "; ".join(error_messages)
    
    logger.warning(f"Validation error on {request.method} {request.url.path}: {detail_msg}")
    return JSONResponse(
        status_code=422,
        content={"detail": f"Validation error: {detail_msg}"}
    )

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request, exc: StarletteHTTPException):
    logger.warning(f"HTTP error on {request.method} {request.url.path}: status_code={exc.status_code}, detail={exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again later."}
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
# app.include_router(trams.router, prefix="/api")


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


