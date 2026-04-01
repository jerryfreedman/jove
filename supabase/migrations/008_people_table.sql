-- ============================================================
-- JOVE — People Table Migration 008
-- Session 11E — Universal relationship layer: people table.
-- Additive only. No existing tables or behavior modified.
-- Reversible: DROP TABLE people CASCADE undoes everything here.
-- ============================================================

-- ============================================================
-- PEOPLE
-- The universal relationship model in Jove's data model.
-- Represents any person in the user's life — not just business contacts.
-- A person does NOT require a company, deal, or business context.
-- Exists in parallel with contacts — does not replace them.
-- Contacts remain the sales-domain relationship model.
-- People become the universal relationship model.
-- No read/write logic or UI wiring in this migration.
-- ============================================================
create table people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  relationship text,
  email text,
  phone text,
  organization_id uuid references accounts(id),
  notes text,
  last_interaction_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────

alter table people enable row level security;
create policy "Users can manage own people" on people
  for all using (auth.uid() = user_id);

-- ── INDEXES ─────────────────────────────────────────────────

create index people_user_id_idx on people(user_id);
create index people_name_idx on people(user_id, name);
create index people_org_idx on people(organization_id) where organization_id is not null;

-- ── UPDATED_AT TRIGGER ──────────────────────────────────────
-- Uses existing update_updated_at() function from 001_initial_schema.sql

create trigger people_updated_at
  before update on people
  for each row execute function update_updated_at();
