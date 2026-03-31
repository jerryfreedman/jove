-- ============================================================
-- JOVE — Migration 004: Interaction Memory Upgrades
-- Session 2 — Additive only. Does not modify any existing columns.
-- Adds source tracking, meeting linkage, origin discipline,
-- intent classification, and routing metadata to interactions.
-- All columns nullable for safe backfill-free rollout.
-- ============================================================

-- ── source_surface: where this interaction was captured ──────
-- Values: home_chat, deal_chat, bird, capture_sheet, briefing, system
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS source_surface text;

-- ── meeting_id: FK to meetings table ────────────────────────
-- Links interactions to the meeting context they came from.
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;

-- ── origin: who/what created this interaction ───────────────
-- Values: user, assistant, system_extracted, user_confirmed
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS origin text;

-- ── intent_type: what this interaction was intended to be ────
-- Values: question, capture, mixed, clarification, draft_intent,
--         debrief, general_intel, update_confirmation
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS intent_type text;

-- ── routing_confidence: numeric confidence from classifier ──
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS routing_confidence numeric;

-- ── routing_metadata: structured context from classification ─
-- Stores: matched deal candidates, contact candidates,
--         ambiguity notes, classifier bucket, selected path
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS routing_metadata jsonb;

-- ── INDEXES ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS interactions_source_surface_idx ON interactions(source_surface);
CREATE INDEX IF NOT EXISTS interactions_meeting_id_idx ON interactions(meeting_id);
CREATE INDEX IF NOT EXISTS interactions_origin_idx ON interactions(origin);
CREATE INDEX IF NOT EXISTS interactions_intent_type_idx ON interactions(intent_type);
