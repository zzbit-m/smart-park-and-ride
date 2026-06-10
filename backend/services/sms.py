import logging
import httpx
from config import settings

logger = logging.getLogger(__name__)

TWILIO_API_URL = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"


async def send_otp(phone: str, otp: str) -> None:
    if settings.DEBUG_OTP or settings.ENV == "development":
        logger.info(f"[SMS] OTP for {phone}: {otp}")
        return

    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN
    from_number = settings.TWILIO_FROM_NUMBER

    if not sid or not token or not from_number:
        raise RuntimeError(
            "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER "
            "must be set in environment when DEBUG_OTP=False"
        )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            TWILIO_API_URL.format(sid=sid),
            auth=(sid, token),
            data={"From": from_number, "To": phone, "Body": f"Your OTP code is: {otp}"},
        )

    if not resp.is_success:
        raise RuntimeError(
            f"Twilio SMS send failed (HTTP {resp.status_code}): {resp.text}"
        )
