import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.layout_sync import apply_layout, _generate_slot_code


# ── Validation tests ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_validate_missing_version():
    db = AsyncMock()
    config = {"label": "x", "zones": [{"zone_name": "Z", "rows": 1, "cols": 1, "slot_prefix": "Z"}]}
    with pytest.raises(ValueError, match="config.version is required"):
        await apply_layout(db, config, "tester")


@pytest.mark.asyncio
async def test_validate_missing_zones():
    db = AsyncMock()
    config = {"version": 1, "label": "x"}
    with pytest.raises(ValueError, match="config.zones is required"):
        await apply_layout(db, config, "tester")


@pytest.mark.asyncio
async def test_validate_empty_zones():
    db = AsyncMock()
    config = {"version": 1, "label": "x", "zones": []}
    with pytest.raises(ValueError, match="config.zones is required and must be a non-empty list"):
        await apply_layout(db, config, "tester")


# ── Slot code generation tests ────────────────────────────────────────────────


def test_slot_code_generation_standard():
    code = _generate_slot_code("A", 3, 10, 1, 3)
    assert code == "A01-03"


def test_slot_code_shorthand_single_row():
    for col in range(1, 11):
        code = _generate_slot_code("A", 1, 10, 1, col)
        assert code == f"A{col:02d}", f"Expected A{col:02d}, got {code}"


# ── Version check tests ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_version_check_rejects_lower_version():
    db = AsyncMock()
    fake_result = MagicMock()
    fake_result.fetchone.return_value = type("Row", (), {"version": 3})()
    db.execute.return_value = fake_result

    config = {
        "version": 2,
        "label": "x",
        "zones": [{"zone_name": "Z", "rows": 1, "cols": 1, "slot_prefix": "Z"}],
    }
    with pytest.raises(RuntimeError, match="higher"):
        await apply_layout(db, config, "tester")


@pytest.mark.asyncio
async def test_version_check_accepts_higher_version():
    db = AsyncMock()
    fake_result = MagicMock()
    fake_result.fetchone.return_value = type("Row", (), {"version": 3})()
    db.execute.return_value = fake_result

    config = {
        "version": 4,
        "label": "x",
        "zones": [{"zone_name": "Z", "rows": 1, "cols": 1, "slot_prefix": "Z"}],
    }
    try:
        await apply_layout(db, config, "tester")
    except RuntimeError as e:
        pytest.fail(f"Unexpected RuntimeError: {e}")
    except Exception:
        pass
