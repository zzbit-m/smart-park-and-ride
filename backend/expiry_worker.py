import asyncio
import logging
from datetime import datetime, timezone
from sqlalchemy import text
from database import AsyncSessionLocal, get_redis
from redis_client import get_slot_key, release_slot, delete_qr_token_lookup

logger = logging.getLogger(__name__)

async def check_and_expire_bookings():
    async with AsyncSessionLocal() as db:
        # 1. Fetch all currently 'held' bookings
        result = await db.execute(
            text("SELECT id, user_id, slot_id, qr_token, expires_at FROM bookings WHERE status = 'held'")
        )
        held_bookings = result.fetchall()
        
        if not held_bookings:
            return

        now = datetime.now(timezone.utc)
        
        for booking in held_bookings:
            booking_id = str(booking.id)
            slot_id = booking.slot_id
            qr_token = booking.qr_token
            expires_at = booking.expires_at

            # Ensure expires_at has timezone info for comparison
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)

            is_expired = False
            is_no_show = False
            
            # Check 1: Has the 15-minute window passed?
            if expires_at < now:
                is_expired = True
                is_no_show = True
                logger.info(f"Booking {booking_id} expired based on database expires_at. No-show triggered.")
            else:
                # Check 2: Has the Redis lock disappeared?
                redis = get_redis()
                slot_key = get_slot_key(slot_id)
                redis_val = await redis.get(slot_key)
                
                # If the Redis key is gone, or is not set to held:booking_id, then lock is gone
                if redis_val != f"held:{booking_id}":
                    is_expired = True
                    logger.info(f"Booking {booking_id} expired because Redis lock value is '{redis_val}' instead of 'held:{booking_id}'.")

            if is_expired:
                # Update DB status (holds that time out are marked as 'expired')
                await db.execute(
                    text("UPDATE bookings SET status = 'expired' WHERE id = :bid"),
                    {"bid": booking.id}
                )
                
                # If it's a no-show, record penalty
                if is_no_show:
                    # Increment user penalty
                    await db.execute(
                        text("UPDATE users SET penalty_count = penalty_count + 1 WHERE id = :uid"),
                        {"uid": booking.user_id}
                    )
                    # Insert penalty event
                    await db.execute(
                        text("""
                            INSERT INTO penalty_events (user_id, booking_id, reason)
                            VALUES (:uid, :bid, 'no_show_hold_expired')
                        """),
                        {"uid": booking.user_id, "bid": booking.id}
                    )
                    # Fetch user to check ban
                    user_res = await db.execute(
                        text("SELECT penalty_count FROM users WHERE id = :uid"),
                        {"uid": booking.user_id}
                    )
                    user_row = user_res.fetchone()
                    if user_row and user_row.penalty_count >= 3:
                        banned_until = now + timedelta(hours=24)
                        await db.execute(
                            text("UPDATE users SET banned_until = :banned_until WHERE id = :uid"),
                            {"banned_until": banned_until, "uid": booking.user_id}
                        )
                        logger.warning(f"User {booking.user_id} banned until {banned_until} due to {user_row.penalty_count} penalties.")

                # Release Redis lock if it is still pointing to this booking
                redis = get_redis()
                slot_key = get_slot_key(slot_id)
                redis_val = await redis.get(slot_key)
                if redis_val == f"held:{booking_id}":
                    await release_slot(slot_id)
                    logger.info(f"Released slot {slot_id} in Redis.")

                # Delete the QR token lookup
                await delete_qr_token_lookup(qr_token)
                logger.info(f"Deleted QR token lookup for booking {booking_id}.")
                
        await db.commit()

async def run_expiry_worker():
    logger.info("Starting background expiry worker loop...")
    while True:
        try:
            await check_and_expire_bookings()
        except asyncio.CancelledError:
            logger.info("Background expiry worker cancelled.")
            raise
        except Exception as e:
            logger.error(f"Error in background expiry worker: {e}", exc_info=True)
        await asyncio.sleep(60)

async def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    from database import init_connections, close_connections
    logger.info("Initializing database connections inside standalone expiry worker...")
    await init_connections()
    try:
        await run_expiry_worker()
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("Expiry worker shutdown signal received.")
    finally:
        logger.info("Closing database connections...")
        await close_connections()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
