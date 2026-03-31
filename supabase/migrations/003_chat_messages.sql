-- ============================================================
-- JOVE — Migration 003: Durable Chat Messages
-- Session 1 — Chat Persistence Foundation
-- Additive only. Does not modify any existing tables.
-- ============================================================

-- chat_messages: raw conversational persistence for every chat interaction.
-- This is NOT a replacement for interactions or signals.
-- It captures the exact text of every user message and assistant reply
-- across all chat surfaces, grouped by thread/session.

create table if not exists chat_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  thread_id text not null,
  role text not null,
  source_surface text not null,
  message_text text not null,
  deal_id uuid references deals(id) on delete set null,
  meeting_id uuid references meetings(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Constraints
alter table chat_messages add constraint chat_messages_role_check
  check (role in ('user', 'assistant'));

alter table chat_messages add constraint chat_messages_source_surface_check
  check (source_surface in ('home_chat', 'deal_chat'));

-- RLS: users can only access their own chat messages
alter table chat_messages enable row level security;

create policy "Users can read own chat messages" on chat_messages
  for select using (auth.uid() = user_id);

create policy "Users can insert own chat messages" on chat_messages
  for insert with check (auth.uid() = user_id);

-- Indexes for common query patterns
create index chat_messages_user_id_idx on chat_messages(user_id);
create index chat_messages_thread_id_idx on chat_messages(thread_id);
create index chat_messages_deal_id_idx on chat_messages(deal_id);
create index chat_messages_created_at_idx on chat_messages(created_at desc);
create index chat_messages_source_surface_idx on chat_messages(source_surface);
