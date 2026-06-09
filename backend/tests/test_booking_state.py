import sys
import os
import pytest
from fastapi import HTTPException

# Add parent dir to path so we can import services
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.booking_state import BookingStateMachine, BookingStatus


def test_valid_transitions():
    # held -> confirmed
    BookingStateMachine.check_transition("held", "confirmed")
    # held -> expired
    BookingStateMachine.check_transition("held", "expired")
    # held -> completed
    BookingStateMachine.check_transition("held", "completed")
    # held -> no_show
    BookingStateMachine.check_transition("held", "no_show")
    
    # confirmed -> completed
    BookingStateMachine.check_transition("confirmed", "completed")


def test_invalid_transitions():
    # confirmed -> expired is invalid
    with pytest.raises(HTTPException) as exc_info:
        BookingStateMachine.check_transition("confirmed", "expired")
    assert exc_info.value.status_code == 400
    assert "Booking is already confirmed" in exc_info.value.detail

    # completed -> confirmed is invalid
    with pytest.raises(HTTPException) as exc_info:
        BookingStateMachine.check_transition("completed", "confirmed")
    assert exc_info.value.status_code == 400
    assert "Booking is already completed" in exc_info.value.detail


def test_invalid_status_values():
    # invalid status
    with pytest.raises(HTTPException) as exc_info:
        BookingStateMachine.check_transition("invalid-state", "confirmed")
    assert exc_info.value.status_code == 400
    assert "Invalid booking status value" in exc_info.value.detail
