from enum import Enum
from fastapi import HTTPException

class BookingStatus(str, Enum):
    HELD = "held"
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    EXPIRED = "expired"
    NO_SHOW = "no_show"

class BookingStateMachine:
    # Allowed transitions for each status
    _VALID_TRANSITIONS = {
        BookingStatus.HELD: {
            BookingStatus.CONFIRMED,
            BookingStatus.EXPIRED,
            BookingStatus.COMPLETED,
            BookingStatus.NO_SHOW,
        },
        BookingStatus.CONFIRMED: {
            BookingStatus.COMPLETED,
        },
        BookingStatus.COMPLETED: set(),
        BookingStatus.EXPIRED: set(),
        BookingStatus.NO_SHOW: set(),
    }

    @classmethod
    def check_transition(cls, current: str, target: str) -> None:
        """
        Validate transition from current status to target status.
        Raises HTTPException(400) if the transition is invalid.
        """
        try:
            curr_enum = BookingStatus(current)
            target_enum = BookingStatus(target)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid booking status value. Current: '{current}', Target: '{target}'"
            )

        if target_enum not in cls._VALID_TRANSITIONS[curr_enum]:
            raise HTTPException(
                status_code=400,
                detail=f"Booking is already {current} — cannot change status to {target}"
            )
