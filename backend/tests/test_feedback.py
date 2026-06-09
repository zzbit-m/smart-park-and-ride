import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException
from pydantic import ValidationError


@pytest.mark.asyncio
@patch("routers.feedback.get_db")
async def test_create_feedback_success(mock_get_db):
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.mappings.return_value.first.return_value = {
        "id": 1,
        "type": "bug",
        "message": "Scan QR not working",
        "email": "user@test.com",
        "status": "open",
        "created_at": "2026-06-09T12:00:00Z",
    }
    mock_db.execute.return_value = mock_result
    mock_get_db.return_value.__aenter__.return_value = mock_db

    from routers.feedback import FeedbackCreate, create_feedback

    body = FeedbackCreate(type="bug", message="Scan QR not working", email="user@test.com")
    result = await create_feedback(body, db=mock_db)

    assert result.id == 1
    assert result.type == "bug"
    assert result.status == "open"

    insert_sql = mock_db.execute.call_args[0][0].text
    assert "INSERT INTO feedback" in insert_sql
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_feedback_empty_message_fails():
    from routers.feedback import FeedbackCreate

    with pytest.raises(ValidationError):
        FeedbackCreate(type="bug", message="")


@pytest.mark.asyncio
async def test_create_feedback_max_length_exceeded_fails():
    from routers.feedback import FeedbackCreate

    with pytest.raises(ValidationError):
        FeedbackCreate(type="bug", message="x" * 2001)


@pytest.mark.asyncio
async def test_create_feedback_invalid_type_fails():
    from routers.feedback import FeedbackCreate

    with pytest.raises(ValidationError):
        FeedbackCreate(type="invalid", message="test")  # type: ignore


@pytest.mark.asyncio
async def test_list_feedback_returns_paginated_response():
    mock_db = AsyncMock()

    count_row = MagicMock()
    count_row.scalar.return_value = 0
    data_row = MagicMock(fetchall=lambda: [])

    async def execute_side(*args, **kwargs):
        sql_text = args[0].text if hasattr(args[0], "text") else str(args[0])
        if "COUNT(*)" in sql_text:
            return count_row
        return data_row

    mock_db.execute.side_effect = execute_side

    from routers.feedback import list_feedback

    result = await list_feedback(
        _={"role": "admin"},
        db=mock_db,
        limit=20,
        offset=0,
    )

    assert result.total == 0
    assert result.items == []
    assert result.limit == 20


@pytest.mark.asyncio
async def test_list_feedback_filters():
    mock_db = AsyncMock()

    count_row = MagicMock()
    count_row.scalar.return_value = 2
    data_row_1 = MagicMock()
    data_row_1._mapping = {
        "id": 1,
        "type": "bug",
        "message": "Bug report",
        "email": "a@b.com",
        "status": "open",
        "created_at": "2026-06-09T12:00:00Z",
    }
    data_row_2 = MagicMock()
    data_row_2._mapping = {
        "id": 2,
        "type": "feature",
        "message": "Feature request",
        "email": None,
        "status": "open",
        "created_at": "2026-06-09T12:01:00Z",
    }

    async def execute_side_effect(*args, **kwargs):
        sql_text = args[0].text if hasattr(args[0], "text") else str(args[0])
        if "COUNT(*)" in sql_text:
            return count_row
        return MagicMock(fetchall=lambda: [data_row_1, data_row_2])

    mock_db.execute.side_effect = execute_side_effect

    from routers.feedback import list_feedback

    result = await list_feedback(
        _={"role": "admin"},
        db=mock_db,
        status="open",
        limit=10,
        offset=0,
    )

    assert result.total == 2
    assert len(result.items) == 2
    assert result.limit == 10
    assert result.offset == 0


@pytest.mark.asyncio
@patch("routers.feedback.get_db")
async def test_update_feedback_status_success(mock_get_db):
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = 1
    mock_db.execute.return_value = mock_result
    mock_get_db.return_value.__aenter__.return_value = mock_db

    from routers.feedback import FeedbackStatusUpdate, update_feedback_status

    body = FeedbackStatusUpdate(status="reviewed")
    result = await update_feedback_status(1, body, _={"role": "admin"}, db=mock_db)

    assert result["ok"] is True
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
@patch("routers.feedback.get_db")
async def test_update_feedback_nonexistent_fails(mock_get_db):
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar.return_value = None
    mock_db.execute.return_value = mock_result
    mock_get_db.return_value.__aenter__.return_value = mock_db

    from routers.feedback import FeedbackStatusUpdate, update_feedback_status

    body = FeedbackStatusUpdate(status="closed")

    with pytest.raises(HTTPException) as exc_info:
        await update_feedback_status(999, body, _={"role": "admin"}, db=mock_db)

    assert exc_info.value.status_code == 404
    assert "not found" in exc_info.value.detail.lower()
