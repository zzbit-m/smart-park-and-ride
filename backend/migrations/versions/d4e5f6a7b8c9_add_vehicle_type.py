"""add_vehicle_type

Revision ID: d4e5f6a7b8c9
Revises: c2d3a4b5e6f7
Create Date: 2026-06-09 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c2d3a4b5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        ALTER TABLE user_vehicles
        ADD COLUMN vehicle_type VARCHAR(20) NOT NULL DEFAULT 'car'
    """))
    op.execute(sa.text("""
        ALTER TABLE bookings
        ADD COLUMN vehicle_type VARCHAR(20) NOT NULL DEFAULT 'car'
    """))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE user_vehicles DROP COLUMN vehicle_type"))
    op.execute(sa.text("ALTER TABLE bookings DROP COLUMN vehicle_type"))
