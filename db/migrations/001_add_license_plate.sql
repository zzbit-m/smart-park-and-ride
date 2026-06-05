-- ============================================================
-- Migration 001: Add license_plate to bookings
-- Run this against an existing database that was created before
-- the license-plate verification feature was added.
-- ============================================================

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20);
