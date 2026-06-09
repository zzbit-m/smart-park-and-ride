-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE slot_status AS ENUM ('available', 'held', 'occupied');
CREATE TYPE booking_status AS ENUM ('held', 'confirmed', 'completed', 'expired', 'no_show');
CREATE TYPE user_role AS ENUM ('user', 'admin', 'dispatcher');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           VARCHAR(20) UNIQUE NOT NULL,
    display_name    VARCHAR(100),
    role            user_role NOT NULL DEFAULT 'user',
    penalty_count   SMALLINT NOT NULL DEFAULT 0,
    banned_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USER VEHICLES (REGISTRY)
-- ============================================================

CREATE TABLE user_vehicles (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    license_plate   VARCHAR(20) NOT NULL,
    province        VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, license_plate, province)
);

CREATE INDEX idx_user_vehicles_user ON user_vehicles(user_id);


-- ============================================================
-- PARKING ZONES & SLOTS
-- ============================================================

CREATE TABLE parking_zones (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,
    tram_stop   VARCHAR(100),
    total_slots INT NOT NULL
);

CREATE TABLE parking_slots (
    id          SERIAL PRIMARY KEY,
    zone_id     INT NOT NULL REFERENCES parking_zones(id),
    slot_code   VARCHAR(20) NOT NULL UNIQUE,
    last_known_status  slot_status NOT NULL DEFAULT 'available',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_slots_zone ON parking_slots(zone_id);

-- ============================================================
-- BOOKINGS
-- ============================================================

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
);

CREATE INDEX idx_bookings_user    ON bookings(user_id);
CREATE INDEX idx_bookings_slot    ON bookings(slot_id);
CREATE INDEX idx_bookings_status  ON bookings(status);
CREATE INDEX idx_bookings_expires ON bookings(expires_at)
    WHERE status = 'held';

-- ============================================================
-- PENALTY LOG
-- ============================================================

CREATE TABLE penalty_events (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    booking_id  UUID NOT NULL REFERENCES bookings(id),
    reason      VARCHAR(50) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TRAM FLEET
-- ============================================================

CREATE TABLE trams (
    id          SERIAL PRIMARY KEY,
    tram_code   VARCHAR(20) UNIQUE NOT NULL,
    capacity    SMALLINT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE tram_schedules (
    id          SERIAL PRIMARY KEY,
    tram_id     INT NOT NULL REFERENCES trams(id),
    zone_id     INT NOT NULL REFERENCES parking_zones(id),
    departure   TIMESTAMPTZ NOT NULL,
    arrival     TIMESTAMPTZ
);

CREATE INDEX idx_tram_sched_zone ON tram_schedules(zone_id, departure);