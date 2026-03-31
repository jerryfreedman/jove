-- ============================================================
-- JOVE — Migration 005: Thread & Retrieval Structure
-- Session 4 — Additive only. Does not modify existing columns.
--
-- Goals:
--   1. First-class thread metadata for entity linkage
--   2. Fix thread_summaries overload with category + entity fields
--   3. Enable future retrieval by thread, deal, meeting, surface, time
-- ============================================================

-- ── PART 1: chat_threads — lightweight thread metadata ─────
-- Provides thread-level entity linkage so future retrieval
-- does not have to infer everything from individual chat_messages rows.
-- One row per chat thread/session.

CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_surface text NOT NULL,
  primary_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  primary_meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL,
  title text,
  message_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE chat_threads ADD CONSTRAINT chat_threads_source_surface_check
  CHECK (source_surface IN ('home_chat', 'deal_chat'));

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chat threads" ON chat_threads
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS chat_threads_user_id_idx ON chat_threads(user_id);
CREATE INDEX IF NOT EXISTS chat_threads_thread_id_idx ON chat_threads(thread_id);
CREATE INDEX IF NOT EXISTS chat_threads_deal_id_idx ON chat_threads(primary_deal_id);
CREATE INDEX IF NOT EXISTS chat_threads_source_surface_idx ON chat_threads(source_surface);
CREATE INDEX IF NOT EXISTS chat_threads_created_at_idx ON chat_threads(created_at DESC);

-- Auto-update updated_at
CREATE TRIGGER chat_threads_updated_at
  BEFORE UPDATE ON chat_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── PART 2: Fix thread_summaries — add category + entity linkage ──
-- Existing rows (briefing summaries) continue to work.
-- New fields are all nullable for backward safety.

-- category: distinguishes briefing_summary vs chat_summary
ALTER TABLE thread_summaries
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'briefing_summary';

-- thread_id: links to the chat thread that generated this summary
ALTER TABLE thread_summaries
  ADD COLUMN IF NOT EXISTS thread_id text;

-- deal_id: for deal-scoped chat summaries
ALTER TABLE thread_summaries
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;

-- source_surface: where the summarized conversation happened
ALTER TABLE thread_summaries
  ADD COLUMN IF NOT EXISTS source_surface text;

-- Indexes for new retrieval dimensions
CREATE INDEX IF NOT EXISTS thread_summaries_category_idx ON thread_summaries(category);
CREATE INDEX IF NOT EXISTS thread_summaries_thread_id_idx ON thread_summaries(thread_id);
CREATE INDEX IF NOT EXISTS thread_summaries_deal_id_idx ON thread_summaries(deal_id);
CREATE INDEX IF NOT EXISTS thread_summaries_source_surface_idx ON thread_summaries(source_surface);


-- ── PART 3: Composite indexes for efficient multi-dimension retrieval ──

-- chat_messages: thread + recency (reconstruct a conversation)
CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx
  ON chat_messages(thread_id, created_at);

-- chat_messages: deal + recency (all chat about a deal)
CREATE INDEX IF NOT EXISTS chat_messages_deal_created_idx
  ON chat_messages(deal_id, created_at)
  WHERE deal_id IS NOT NULL;

-- chat_messages: user + surface + recency (all home_chat or deal_chat for a user)
CREATE INDEX IF NOT EXISTS chat_messages_user_surface_created_idx
  ON chat_messages(user_id, source_surface, created_at DESC);

-- thread_summaries: user + category + recency (get briefing summaries vs chat summaries)
CREATE INDEX IF NOT EXISTS thread_summaries_user_category_date_idx
  ON thread_summaries(user_id, category, summary_date DESC);

-- thread_summaries: deal + category (get all chat summaries for a deal)
CREATE INDEX IF NOT EXISTS thread_summaries_deal_category_idx
  ON thread_summaries(deal_id, category)
  WHERE deal_id IS NOT NULL;
