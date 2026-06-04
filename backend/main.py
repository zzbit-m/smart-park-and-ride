from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from redis_client import init_redis, close_redis
from routers import slots


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_redis()
    yield
    # Shutdown
    await close_redis()


app = FastAPI(
    title="Smart Park & Ride API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Phase 3 will restrict this to the frontend domain
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(slots.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
