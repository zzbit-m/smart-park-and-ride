"""baseline_schema

Revision ID: fbf9b5550ea9
Revises: 
Create Date: 2026-06-08 22:47:41.792988

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fbf9b5550ea9'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create ENUM types
    op.execute(sa.text("CREATE TYPE slot_status AS ENUM ('available', 'held', 'occupied')"))
    op.execute(sa.text("CREATE TYPE booking_status AS ENUM ('held', 'confirmed', 'completed', 'expired', 'no_show')"))
    op.execute(sa.text("CREATE TYPE user_role AS ENUM ('user', 'admin', 'dispatcher')"))
    
    # Create Tables
    op.execute(sa.text("""
        CREATE TABLE users (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone           VARCHAR(20) UNIQUE NOT NULL,
            display_name    VARCHAR(100),
            role            user_role NOT NULL DEFAULT 'user',
            penalty_count   SMALLINT NOT NULL DEFAULT 0,
            banned_until    TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    
    op.execute(sa.text("""
        CREATE TABLE parking_zones (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(50) NOT NULL,
            tram_stop   VARCHAR(100),
            total_slots INT NOT NULL
        )
    """))
    
    op.execute(sa.text("""
        CREATE TABLE parking_slots (
            id          SERIAL PRIMARY KEY,
            zone_id     INT NOT NULL REFERENCES parking_zones(id),
            slot_code   VARCHAR(20) NOT NULL UNIQUE,
            last_known_status  slot_status NOT NULL DEFAULT 'available',
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    
    op.execute(sa.text("CREATE INDEX idx_slots_zone ON parking_slots(zone_id)"))

    op.execute(sa.text("""
        CREATE TABLE bookings (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id         UUID NOT NULL REFERENCES users(id),
            slot_id         INT NOT NULL REFERENCES parking_slots(id),
            status          booking_status NOT NULL DEFAULT 'held',
            qr_token        VARCHAR(128) UNIQUE NOT NULL,
            license_plate   VARCHAR(20),
            held_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at      TIMESTAMPTZ NOT NULL,
            checked_in_at   TIMESTAMPTZ,
            checked_out_at  TIMESTAMPTZ,
            flagged         BOOLEAN NOT NULL DEFAULT FALSE
        )
    """))
    
    op.execute(sa.text("CREATE INDEX idx_bookings_user ON bookings(user_id)"))
    op.execute(sa.text("CREATE INDEX idx_bookings_slot ON bookings(slot_id)"))
    op.execute(sa.text("CREATE INDEX idx_bookings_status ON bookings(status)"))
    op.execute(sa.text("CREATE INDEX idx_bookings_expires ON bookings(expires_at) WHERE status = 'held'"))

    op.execute(sa.text("""
        CREATE TABLE penalty_events (
            id          SERIAL PRIMARY KEY,
            user_id     UUID NOT NULL REFERENCES users(id),
            booking_id  UUID NOT NULL REFERENCES bookings(id),
            reason      VARCHAR(50) NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))

    op.execute(sa.text("""
        CREATE TABLE trams (
            id          SERIAL PRIMARY KEY,
            tram_code   VARCHAR(20) UNIQUE NOT NULL,
            capacity    SMALLINT NOT NULL,
            is_active   BOOLEAN NOT NULL DEFAULT TRUE
        )
    """))

    op.execute(sa.text("""
        CREATE TABLE tram_schedules (
            id          SERIAL PRIMARY KEY,
            tram_id     INT NOT NULL REFERENCES trams(id),
            zone_id     INT NOT NULL REFERENCES parking_zones(id),
            departure   TIMESTAMPTZ NOT NULL,
            arrival     TIMESTAMPTZ
        )
    """))

    op.execute(sa.text("CREATE INDEX idx_tram_sched_zone ON tram_schedules(zone_id, departure)"))


def downgrade() -> None:
    """Downgrade schema."""
    # Drop Tables
    op.execute(sa.text("DROP TABLE IF EXISTS tram_schedules CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS trams CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS penalty_events CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS bookings CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS parking_slots CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS parking_zones CASCADE"))
    op.execute(sa.text("DROP TABLE IF EXISTS users CASCADE"))
    
    # Drop ENUM types
    op.execute(sa.text("DROP TYPE IF EXISTS user_role CASCADE"))
    op.execute(sa.text("DROP TYPE IF EXISTS booking_status CASCADE"))
    op.execute(sa.text("DROP TYPE IF EXISTS slot_status CASCADE"))
