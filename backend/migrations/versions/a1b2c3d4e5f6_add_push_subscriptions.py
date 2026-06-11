"""add_push_subscriptions

Revision ID: a1b2c3d4e5f6
Revises: f7b8c9d0e1f2
Create Date: 2026-06-11 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "f7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id          SERIAL PRIMARY KEY,
            user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint    TEXT NOT NULL UNIQUE,
            p256dh      TEXT NOT NULL,
            auth        TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS idx_push_subs_user
        ON push_subscriptions(user_id)
    """))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS push_subscriptions CASCADE"))
