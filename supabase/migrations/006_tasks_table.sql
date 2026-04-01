-- ============================================================
-- JOVE — Tasks Table Migration 006
-- Session 11A — First universal primitive: tasks table.
-- Additive only. No existing tables or behavior modified.
-- Reversible: DROP TABLE tasks CASCADE undoes everything here.
-- ============================================================

-- ============================================================
-- TASKS
-- The first universal primitive in Jove's data model.
-- Supports both user-created and system-derived tasks.
-- Linked optionally to deals and meetings via nullable FKs.
-- item_id is a nullable placeholder for future items table.
-- source distinguishes user-created tasks from system-derived ones.
-- source_type classifies the system derivation origin.
-- action stores the structured action payload (same shape as TaskAction).
-- ============================================================
create table tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  status text not null default 'pending',
  priority integer,
  due_at timestamptz,
  item_id uuid,
  deal_id uuid references deals(id) on delete set null,
  meeting_id uuid references meetings(id) on delete set null,
  source text not null default 'user',
  source_type text,
  action jsonb,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── CONSTRAINTS ─────────────────────────────────────────────

alter table tasks add constraint tasks_status_check
  check (status in ('pending', 'in_progress', 'done', 'skipped'));

alter table tasks add constraint tasks_source_check
  check (source in ('user', 'system'));

alter table tasks add constraint tasks_source_type_check
  check (source_type in (
    'meeting_prep',
    'meeting_followup',
    'deal_next_step',
    'reengage',
    'item_next_step'
  ));

-- ── ROW LEVEL SECURITY ─────────────────────────────────────

alter table tasks enable row level security;
create policy "Users can manage own tasks" on tasks
  for all using (auth.uid() = user_id);

-- ── INDEXES ─────────────────────────────────────────────────

create index tasks_user_id_idx on tasks(user_id);
create index tasks_status_idx on tasks(user_id, status);
create index tasks_due_at_idx on tasks(user_id, due_at) where due_at is not null;
create index tasks_deal_id_idx on tasks(deal_id) where deal_id is not null;
create index tasks_meeting_id_idx on tasks(meeting_id) where meeting_id is not null;

-- ── UPDATED_AT TRIGGER ──────────────────────────────────────
-- Uses existing update_updated_at() function from 001_initial_schema.sql

create trigger tasks_updated_at
  before update on tasks
  for each row execute function update_updated_at();
