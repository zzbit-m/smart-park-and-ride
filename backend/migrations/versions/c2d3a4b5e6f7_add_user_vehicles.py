"""add_user_vehicles

Revision ID: c2d3a4b5e6f7
Revises: fbf9b5550ea9
Create Date: 2026-06-09 08:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3a4b5e6f7'
down_revision: Union[str, Sequence[str], None] = 'fbf9b5550ea9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE user_vehicles (
            id            SERIAL PRIMARY KEY,
            user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            license_plate VARCHAR(20) NOT NULL,
            province      VARCHAR(100) NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, license_plate, province)
        )
    """))
    op.execute(sa.text("CREATE INDEX idx_user_vehicles_user ON user_vehicles(user_id)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS user_vehicles CASCADE"))
