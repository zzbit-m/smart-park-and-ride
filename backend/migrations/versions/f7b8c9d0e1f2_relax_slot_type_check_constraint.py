"""relax_slot_type_check_constraint

Revision ID: f7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-10 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("""
        ALTER TABLE parking_layout_slots
        DROP CONSTRAINT IF EXISTS parking_layout_slots_slot_type_check
    """))
    op.execute(sa.text("""
        ALTER TABLE parking_layout_slots
        ADD CONSTRAINT parking_layout_slots_slot_type_check
        CHECK (slot_type IN ('standard', 'disabled', 'ev', 'motorcycle'))
    """))


def downgrade() -> None:
    op.execute(sa.text("""
        ALTER TABLE parking_layout_slots
        DROP CONSTRAINT IF EXISTS parking_layout_slots_slot_type_check
    """))
    op.execute(sa.text("""
        ALTER TABLE parking_layout_slots
        ADD CONSTRAINT parking_layout_slots_slot_type_check
        CHECK (slot_type IN ('standard', 'disabled', 'ev'))
    """))

