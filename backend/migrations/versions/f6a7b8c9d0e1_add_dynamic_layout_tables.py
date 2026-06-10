"""add_dynamic_layout_tables

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-10 11:51:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add column slot_status to parking_slots
    op.execute(sa.text("""
        ALTER TABLE parking_slots
        ADD COLUMN slot_status VARCHAR(20) NOT NULL DEFAULT 'active'
    """))
    op.execute(sa.text("""
        ALTER TABLE parking_slots
        ADD CONSTRAINT parking_slots_status_check CHECK (slot_status IN ('active', 'maintenance', 'removed'))
    """))
    op.execute(sa.text("""
        UPDATE parking_slots SET slot_status = 'active' WHERE slot_status IS NULL
    """))

    # 2. Create table parking_layouts
    op.execute(sa.text("""
        CREATE TABLE parking_layouts (
            id            SERIAL PRIMARY KEY,
            version       INTEGER NOT NULL,
            label         TEXT NOT NULL,
            config        JSONB NOT NULL,
            uploaded_by   TEXT NOT NULL DEFAULT 'system',
            uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            is_active     BOOLEAN NOT NULL DEFAULT FALSE,
            activated_at  TIMESTAMPTZ
        )
    """))

    # 3. Create table parking_layout_slots
    op.execute(sa.text("""
        CREATE TABLE parking_layout_slots (
            id          SERIAL PRIMARY KEY,
            layout_id   INTEGER NOT NULL REFERENCES parking_layouts(id),
            zone_name   TEXT NOT NULL,
            slot_code   TEXT NOT NULL,
            row_number  INTEGER NOT NULL,
            col_number  INTEGER NOT NULL,
            slot_type   TEXT NOT NULL DEFAULT 'standard' CHECK (slot_type IN ('standard', 'disabled', 'ev')),
            UNIQUE(layout_id, zone_name, row_number, col_number)
        )
    """))

    # 4. Create partial unique index
    op.execute(sa.text("""
        CREATE UNIQUE INDEX one_active_layout ON parking_layouts (is_active) WHERE is_active = TRUE
    """))


def downgrade() -> None:
    # Drop index
    op.execute(sa.text("DROP INDEX IF EXISTS one_active_layout"))

    # Drop tables
    op.execute(sa.text("DROP TABLE IF EXISTS parking_layout_slots CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS parking_layouts CASCADE"))

    # Drop constraint then column
    op.execute(sa.text("ALTER TABLE parking_slots DROP CONSTRAINT IF EXISTS parking_slots_status_check"))
    op.execute(sa.text("ALTER TABLE parking_slots DROP COLUMN IF EXISTS slot_status"))
