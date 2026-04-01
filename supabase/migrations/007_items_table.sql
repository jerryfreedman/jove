-- ============================================================
-- JOVE — Items Table Migration 007
-- Session 11D — Universal primary entity: items table.
-- Additive only. No existing tables or behavior modified.
-- Reversible: DROP TABLE items CASCADE undoes everything here.
-- ============================================================

-- ============================================================
-- ITEMS
-- The universal primary entity in Jove's data model.
-- Represents anything the user is working on or organizing:
-- projects, focuses, threads, contexts, goals, etc.
-- Exists in parallel with deals — does not replace them.
-- Tasks already have a nullable item_id placeholder (006).
-- No read/write logic or UI wiring in this migration.
-- ============================================================
create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  category text,
  context_score numeric default 0,
  due_at timestamptz,
  last_activity_at timestamptz default now(),
  notes text,
  is_starred boolean default false,
  snoozed_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── CONSTRAINTS ─────────────────────────────────────────────

alter table items add constraint items_status_check
  check (status in ('active', 'paused', 'waiting', 'done', 'dropped'));

-- ── ROW LEVEL SECURITY ─────────────────────────────────────

alter table items enable row level security;
create policy "Users can manage own items" on items
  for all using (auth.uid() = user_id);

-- ── INDEXES ─────────────────────────────────────────────────

create index items_user_id_idx on items(user_id);
create index items_status_idx on items(user_id, status);
create index items_due_at_idx on items(user_id, due_at) where due_at is not null;
create index items_starred_idx on items(user_id, is_starred);

-- ── UPDATED_AT TRIGGER ──────────────────────────────────────
-- Uses existing update_updated_at() function from 001_initial_schema.sql

create trigger items_updated_at
  before update on items
  for each row execute function update_updated_at();
