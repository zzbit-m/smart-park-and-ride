"""add_feedback_table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-09 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE feedback (
            id          SERIAL PRIMARY KEY,
            type        VARCHAR(20) NOT NULL CHECK (type IN ('bug', 'feature', 'general')),
            message     TEXT NOT NULL,
            email       VARCHAR(255),
            status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'closed')),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text("CREATE INDEX idx_feedback_status ON feedback(status)"))
    op.execute(sa.text("CREATE INDEX idx_feedback_type ON feedback(type)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS feedback CASCADE"))
