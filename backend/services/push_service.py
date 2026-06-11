import json
import logging

from pywebpush import webpush, WebPushException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings

logger = logging.getLogger(__name__)


async def send_push(
    endpoint: str, p256dh: str, auth: str,
    title: str, body: str, data: dict | None = None,
) -> bool:
    if not settings.VAPID_PRIVATE_KEY or not settings.VAPID_PUBLIC_KEY:
        return False

    try:
        payload = json.dumps({
            "title": title,
            "body": body,
            "data": data or {},
        })
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": f"mailto:{settings.VAPID_CLAIMS_EMAIL}"},
        )
        return True
    except WebPushException as e:
        if e.response and e.response.status_code == 410:
            logger.info("Push subscription gone (410), caller should delete: %s", endpoint)
            raise
        logger.warning("Push send failed for %s: %s", endpoint, e)
        return False
    except Exception as e:
        logger.error("Unexpected push error for %s: %s", endpoint, e)
        return False


async def send_push_to_user(
    db: AsyncSession, user_id: str,
    title: str, body: str, data: dict | None = None,
):
    result = await db.execute(
        text("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = :uid"),
        {"uid": user_id},
    )
    subs = result.fetchall()
    for sub in subs:
        try:
            await send_push(sub.endpoint, sub.p256dh, sub.auth, title, body, data)
        except WebPushException:
            await db.execute(
                text("DELETE FROM push_subscriptions WHERE endpoint = :ep"),
                {"ep": sub.endpoint},
            )
