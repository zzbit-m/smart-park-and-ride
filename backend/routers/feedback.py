from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from routers.admin import verify_admin_token
from services.rate_limit import RateLimiter

router = APIRouter(prefix="/feedback", tags=["feedback"])


class FeedbackCreate(BaseModel):
    type: Literal["bug", "feature", "general"]
    message: str = Field(min_length=1, max_length=2000)
    email: str | None = None


class FeedbackOut(BaseModel):
    id: int
    type: str
    message: str
    email: str | None
    status: str
    created_at: str


class FeedbackListResponse(BaseModel):
    items: list[FeedbackOut]
    total: int
    limit: int
    offset: int


class FeedbackStatusUpdate(BaseModel):
    status: Literal["open", "reviewed", "closed"]


@router.post("/", status_code=201)
async def create_feedback(
    body: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(RateLimiter("feedback", 10, 60)),
):
    result = await db.execute(
        text(
            "INSERT INTO feedback (type, message, email) "
            "VALUES (:type, :message, :email) "
            "RETURNING id, type, message, email, status, "
            "to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at"
        ),
        {"type": body.type, "message": body.message, "email": body.email},
    )
    await db.commit()
    row = result.mappings().first()
    return FeedbackOut(**row)


@router.get("/")
async def list_feedback(
    _: dict = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
    status: str | None = None,
    type: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    conditions = []
    params: dict = {"limit": limit, "offset": offset}

    if status:
        conditions.append("status = :status")
        params["status"] = status
    if type:
        conditions.append("type = :type")
        params["type"] = type

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM feedback {where_clause}"), params
    )
    total = count_result.scalar()

    rows_result = await db.execute(
        text(
            f"SELECT id, type, message, email, status, "
            f"to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at "
            f"FROM feedback {where_clause} "
            f"ORDER BY created_at DESC "
            f"LIMIT :limit OFFSET :offset"
        ),
        params,
    )
    items = [FeedbackOut(**row._mapping) for row in rows_result.fetchall()]

    return FeedbackListResponse(items=items, total=total, limit=limit, offset=offset)


@router.patch("/{feedback_id}")
async def update_feedback_status(
    feedback_id: int,
    body: FeedbackStatusUpdate,
    _: dict = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("UPDATE feedback SET status = :status WHERE id = :id RETURNING id"),
        {"status": body.status, "id": feedback_id},
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Feedback not found")
    await db.commit()
    return {"ok": True}
