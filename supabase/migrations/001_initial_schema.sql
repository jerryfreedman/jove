-- ============================================================
-- JOVE — Initial Schema Migration 001
-- Session 1 — Never modify this file. Add new migrations only.
-- Multi-tenant: every table has user_id + RLS.
-- No user can ever see another user's data.
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS
-- One row per authenticated user. Created on first Google OAuth login.
-- company, role, and industry are null until set during onboarding.
-- Never hardcode defaults here.
-- ============================================================
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  company text,
  role text,
  industry text,
  onboarding_completed boolean default false,
  pulse_check_days integer default 10,
  morning_digest_enabled boolean default true,
  weather_enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table users enable row level security;
create policy "Users can read own row" on users
  for select using (auth.uid() = id);
create policy "Users can update own row" on users
  for update using (auth.uid() = id);
create policy "Users can insert own row" on users
  for insert with check (auth.uid() = id);

-- ============================================================
-- ACCOUNTS
-- Companies the user sells into.
-- Created by the user during onboarding or manually.
-- Never seeded with example data.
-- ============================================================
create table accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  industry text,
  website text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table accounts enable row level security;
create policy "Users can manage own accounts" on accounts
  for all using (auth.uid() = user_id);
create index accounts_user_id_idx on accounts(user_id);

-- ============================================================
-- CONTACTS
-- People at each account. Linked to account, not deal.
-- relationship_summary is a running Claude-generated summary
-- updated by the extraction worker after every relevant capture.
-- All fields populated by the user or extraction worker — never seeded.
-- ============================================================
create table contacts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  linkedin_url text,
  is_champion boolean default false,
  relationship_temperature text default 'neutral',
  last_interaction_at timestamptz,
  relationship_summary text,
  personal_context text,
  communication_style text,
  location text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table contacts enable row level security;
create policy "Users can manage own contacts" on contacts
  for all using (auth.uid() = user_id);
create index contacts_user_id_idx on contacts(user_id);
create index contacts_account_id_idx on contacts(account_id);

-- ============================================================
-- DEALS
-- Opportunities. Linked to account.
-- intel_score, momentum_score, signal_velocity updated by extraction worker.
-- Stage values are universal — not industry specific.
-- ============================================================
create table deals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  stage text not null default 'Prospect',
  value numeric,
  next_action text,
  next_action_confirmed boolean default false,
  snoozed_until timestamptz,
  last_activity_at timestamptz default now(),
  intel_score numeric default 0,
  momentum_score numeric default 0,
  signal_velocity numeric default 0,
  notes text,
  is_starred boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table deals add constraint deals_stage_check
  check (stage in (
    'Prospect', 'Discovery', 'POC', 'Proposal',
    'Negotiation', 'Closed Won', 'Closed Lost'
  ));

alter table deals enable row level security;
create policy "Users can manage own deals" on deals
  for all using (auth.uid() = user_id);
create index deals_user_id_idx on deals(user_id);
create index deals_account_id_idx on deals(account_id);
create index deals_stage_idx on deals(stage);
create index deals_last_activity_idx on deals(last_activity_at);

-- ============================================================
-- INTERACTIONS
-- Every raw capture. The core ingestion table.
-- raw_content: exactly what the user typed or pasted — saved instantly.
-- final_sent_content: the confirmed sent version of a drafted email.
--   This closes the draft loop and feeds voice profile learning.
-- extraction_status tracks the background worker's progress.
-- Never blocks the user — raw_content saves in under 200ms.
-- ============================================================
create table interactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  type text not null,
  raw_content text not null,
  processed_content text,
  final_sent_content text,
  extraction_status text default 'pending',
  extracted_at timestamptz,
  created_at timestamptz default now()
);

alter table interactions add constraint interactions_type_check
  check (type in (
    'debrief', 'email_received', 'email_sent',
    'draft', 'idea', 'note', 'meeting_log'
  ));

alter table interactions add constraint interactions_extraction_status_check
  check (extraction_status in ('pending', 'processing', 'complete', 'failed'));

alter table interactions enable row level security;
create policy "Users can manage own interactions" on interactions
  for all using (auth.uid() = user_id);
create index interactions_user_id_idx on interactions(user_id);
create index interactions_deal_id_idx on interactions(deal_id);
create index interactions_extraction_status_idx on interactions(extraction_status);
create index interactions_created_at_idx on interactions(created_at desc);

-- ============================================================
-- SIGNALS
-- Structured intelligence extracted from interactions by the worker.
-- Never entered manually — always written by the extraction worker.
-- signal_type values are universal across all sales verticals.
-- ============================================================
create table signals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  deal_id uuid references deals(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  interaction_id uuid references interactions(id) on delete cascade,
  signal_type text not null,
  content text not null,
  confidence_score numeric default 0.8,
  is_duplicate boolean default false,
  created_at timestamptz default now()
);

alter table signals add constraint signals_type_check
  check (signal_type in (
    'champion_identified', 'timeline_mentioned', 'budget_mentioned',
    'competitor_mentioned', 'objection_raised', 'positive_sentiment',
    'negative_sentiment', 'next_step_agreed', 'stakeholder_mentioned',
    'technical_requirement', 'commercial_signal', 'relationship_context',
    'idea_captured', 'risk_identified', 'opportunity_identified'
  ));

alter table signals enable row level security;
create policy "Users can manage own signals" on signals
  for all using (auth.uid() = user_id);
create index signals_user_id_idx on signals(user_id);
create index signals_deal_id_idx on signals(deal_id);
create index signals_created_at_idx on signals(created_at desc);

-- ============================================================
-- MEETINGS
-- Scheduled meetings. Linked optionally to a deal.
-- debrief_prompted_at tracks when Jove surfaced the proactive
--   debrief card so it never prompts twice for the same meeting.
-- ============================================================
create table meetings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  title text not null,
  attendees text,
  scheduled_at timestamptz not null,
  prep_generated boolean default false,
  debrief_completed boolean default false,
  debrief_prompted_at timestamptz,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table meetings add constraint meetings_source_check
  check (source in ('manual', 'calendar_screenshot'));

alter table meetings enable row level security;
create policy "Users can manage own meetings" on meetings
  for all using (auth.uid() = user_id);
create index meetings_user_id_idx on meetings(user_id);
create index meetings_scheduled_at_idx on meetings(scheduled_at);
create index meetings_deal_id_idx on meetings(deal_id);

-- ============================================================
-- VOICE PROFILE
-- One row per user. Learned from email drafts and confirmed sent emails.
-- Updated incrementally by extraction worker — never seeded.
-- ============================================================
create table voice_profile (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade unique,
  opening_style text,
  closing_style text,
  avg_length text,
  formality_level text,
  common_phrases text[],
  sample_count integer default 0,
  last_updated_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table voice_profile enable row level security;
create policy "Users can manage own voice profile" on voice_profile
  for all using (auth.uid() = user_id);

-- ============================================================
-- KNOWLEDGE BASE
-- Products and services the user sells.
-- Populated during onboarding when the user describes what they sell.
-- Never seeded with hardcoded product data.
-- is_active_deal flags products currently involved in an active deal
--   so Claude can prioritize them in all AI responses.
-- ============================================================
create table knowledge_base (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  product_name text not null,
  description text not null,
  key_features text[],
  target_use_cases text[],
  version integer default 1,
  is_active_deal boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table knowledge_base enable row level security;
create policy "Users can manage own knowledge base" on knowledge_base
  for all using (auth.uid() = user_id);
create index knowledge_base_user_id_idx on knowledge_base(user_id);

-- ============================================================
-- IDEAS
-- Pre-opportunity intelligence. Captured via the idea tile.
-- status tracks progression from raw idea to linked deal.
-- When status becomes 'linked', deal_id is populated.
-- ============================================================
create table ideas (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  content text not null,
  status text default 'raw',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table ideas add constraint ideas_status_check
  check (status in ('raw', 'developing', 'linked', 'archived'));

alter table ideas enable row level security;
create policy "Users can manage own ideas" on ideas
  for all using (auth.uid() = user_id);
create index ideas_user_id_idx on ideas(user_id);

-- ============================================================
-- THREAD SUMMARIES
-- Briefing session summaries for the digest memory layer.
-- Future briefings reference these to track what changed,
-- what was confirmed, and what was snoozed across sessions.
-- ============================================================
create table thread_summaries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  summary_date date not null,
  content text not null,
  confirmed_action_ids uuid[],
  snoozed_action_ids uuid[],
  created_at timestamptz default now()
);

alter table thread_summaries enable row level security;
create policy "Users can manage own thread summaries" on thread_summaries
  for all using (auth.uid() = user_id);
create index thread_summaries_user_id_idx on thread_summaries(user_id);
create index thread_summaries_date_idx on thread_summaries(summary_date desc);

-- ============================================================
-- STREAK LOG
-- One row per weekday the user captures something.
-- Weekends never recorded here — handled in application code.
-- unique(user_id, log_date) prevents duplicate entries.
-- Grace day logic and milestone detection handled in application code.
-- ============================================================
create table streak_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  log_date date not null,
  capture_count integer default 1,
  created_at timestamptz default now(),
  unique(user_id, log_date)
);

alter table streak_log enable row level security;
create policy "Users can manage own streak log" on streak_log
  for all using (auth.uid() = user_id);
create index streak_log_user_id_idx on streak_log(user_id);
create index streak_log_date_idx on streak_log(log_date desc);

-- ============================================================
-- UPDATED_AT TRIGGER
-- Automatically updates updated_at timestamp on every row update.
-- Applied to all tables that have an updated_at column.
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at
  before update on users
  for each row execute function update_updated_at();

create trigger accounts_updated_at
  before update on accounts
  for each row execute function update_updated_at();

create trigger contacts_updated_at
  before update on contacts
  for each row execute function update_updated_at();

create trigger deals_updated_at
  before update on deals
  for each row execute function update_updated_at();

create trigger meetings_updated_at
  before update on meetings
  for each row execute function update_updated_at();

create trigger knowledge_base_updated_at
  before update on knowledge_base
  for each row execute function update_updated_at();

create trigger ideas_updated_at
  before update on ideas
  for each row execute function update_updated_at();
