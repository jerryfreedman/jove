-- Add value_type column to deals table
-- This column was added manually to production on 2026-03-28
-- Running this migration is safe (IF NOT EXISTS guard)

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS value_type text DEFAULT 'mrr'
  CHECK (value_type IN ('mrr', 'arr', 'one_time'));
