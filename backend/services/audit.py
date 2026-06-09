import logging
from datetime import datetime, timezone

logger = logging.getLogger("audit")

def log_audit(actor: str, action: str, details: str) -> None:
    """
    Log a structured audit event.
    Format is designed to be easily machine-readable and grep-able.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    logger.info(f"[AUDIT] timestamp='{timestamp}' actor='{actor}' action='{action}' details='{details}'")
