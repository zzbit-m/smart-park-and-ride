import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from routers.users import verify_user_token
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/push", tags=["push"])


class KeysModel(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: KeysModel


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.get("/vapid-public-key")
async def vapid_public_key():
    return {"public_key": settings.VAPID_PUBLIC_KEY or ""}


@router.post("/subscribe")
async def subscribe(
    body: SubscribeBody,
    auth_payload: dict = Depends(verify_user_token),
    db: AsyncSession = Depends(get_db),
):
    user_id = auth_payload.get("sub")
    await db.execute(
        text("""
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES (:uid, :endpoint, :p256dh, :auth)
            ON CONFLICT (endpoint)
            DO UPDATE SET p256dh = :p256dh2, auth = :auth2
        """),
        {
            "uid": user_id,
            "endpoint": body.endpoint,
            "p256dh": body.keys.p256dh,
            "auth": body.keys.auth,
            "p256dh2": body.keys.p256dh,
            "auth2": body.keys.auth,
        },
    )
    await db.commit()
    return {"message": "Subscribed"}


@router.delete("/subscribe")
async def unsubscribe(
    body: UnsubscribeBody,
    auth_payload: dict = Depends(verify_user_token),
    db: AsyncSession = Depends(get_db),
):
    user_id = auth_payload.get("sub")
    await db.execute(
        text("DELETE FROM push_subscriptions WHERE endpoint = :endpoint AND user_id = :uid"),
        {"endpoint": body.endpoint, "uid": user_id},
    )
    await db.commit()
    return {"message": "Unsubscribed"}
