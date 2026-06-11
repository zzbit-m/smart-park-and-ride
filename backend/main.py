import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

try:
    import sentry_sdk
    from sentry_sdk.integrations.asgi import SentryAsgiMiddleware
except ImportError:  # pragma: no cover
    sentry_sdk = None
    SentryAsgiMiddleware = None

from database import check_postgres, check_redis, close_connections, init_connections
from auto_seed import auto_seed
from routers import admin, slots, auth, users, feedback, push
from config import settings

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allowed origins are read from settings (comma-separated).
# For local development the defaults cover VS Code Live Server (5500)
# and direct backend access.
# In production, set CORS_ALLOWED_ORIGINS to your real frontend domain:
#         CORS_ALLOWED_ORIGINS=https://your-app.example.com
_raw_origins = settings.CORS_ALLOWED_ORIGINS
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

for origin in ALLOWED_ORIGINS:
    logger.info("CORS allowed origin: %s", origin)

if settings.SENTRY_DSN and sentry_sdk is not None:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        environment=os.getenv("ENV", "development"),
    )
    logger.info("Sentry monitoring enabled")
elif settings.SENTRY_DSN:
    logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; install sentry-sdk to enable error tracking")




@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_connections()
    await auto_seed()   # no-op when parking_slots already has rows
    try:
        yield
    finally:
        await close_connections()


app = FastAPI(
    title="Smart Park & Ride API",
    version="0.1.0",
    lifespan=lifespan,
)

if settings.SENTRY_DSN and SentryAsgiMiddleware is not None:
    app.add_middleware(SentryAsgiMiddleware)

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
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


ADMIN_LAYOUT_DIR = os.getenv("ADMIN_LAYOUT_DIR", os.path.join(os.path.dirname(__file__), "..", "frontend", "admin-layout", "dist"))
if os.path.isdir(ADMIN_LAYOUT_DIR):
    app.mount("/admin-layout/assets", StaticFiles(directory=os.path.join(ADMIN_LAYOUT_DIR, "assets")), name="admin_layout_assets")
    @app.get("/admin-layout/{full_path:path}")
    async def serve_admin_layout(full_path: str):
        file_path = os.path.join(ADMIN_LAYOUT_DIR, full_path) if full_path else os.path.join(ADMIN_LAYOUT_DIR, "index.html")
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(ADMIN_LAYOUT_DIR, "index.html"))
    logger.info("admin-layout React SPA mounted at /admin-layout/")

FRONTEND_DIR = os.getenv("FRONTEND_DIR", os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.isdir(FRONTEND_DIR):
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        @app.get("/", include_in_schema=False)
        async def serve_index():
            return FileResponse(index_path)

    _frontend_files = {
        "/admin.html":     ("admin.html", "text/html"),
        "/admin.js":       ("admin.js", "application/javascript"),
        "/app.js":         ("app.js", "application/javascript"),
        "/config.js":      ("config.js", "application/javascript"),
        "/style.css":      ("style.css", "text/css"),
    }
    for route, (rel_path, mime) in _frontend_files.items():
        abs_path = os.path.join(FRONTEND_DIR, rel_path)
        if os.path.isfile(abs_path):
            app.get(route, include_in_schema=False)(lambda p=abs_path, m=mime: FileResponse(p, media_type=m))

    logger.info("frontend static files mounted from %s", FRONTEND_DIR)

app.include_router(admin.router, prefix="/api")
app.include_router(slots.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(push.router, prefix="/api")
# app.include_router(trams.router, prefix="/api")


@app.get("/health")
async def health(response: Response):
    """
    Verify PostgreSQL and Redis are reachable.
    Returns HTTP 200 when both are healthy, 503 otherwise.
    """
    checks = {"postgres": False, "redis": False}
    errors: list[str] = []

    try:
        checks["postgres"] = await check_postgres()
    except Exception as exc:
        errors.append(f"postgres: {exc}")
        logger.error(f"Health check: postgres is offline: {exc}")

    try:
        checks["redis"] = await check_redis()
    except Exception as exc:
        errors.append(f"redis: {exc}")
        logger.error(f"Health check: redis is offline: {exc}")

    healthy = checks["postgres"] and checks["redis"]
    payload = {
        "status": "ok" if healthy else "degraded",
        "checks": checks,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if errors:
        payload["errors"] = errors

    if not healthy:
        response.status_code = 503

    return payload


