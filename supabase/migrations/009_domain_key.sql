-- ============================================================
-- JOVE — Migration 009: Persist domain_key on users table
-- Session 10 — Domain identity becomes real.
-- Default is 'custom' (universal), NOT 'sales'.
-- ============================================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS domain_key TEXT NOT NULL DEFAULT 'custom';

CREATE INDEX IF NOT EXISTS users_domain_key_idx ON users(domain_key);
