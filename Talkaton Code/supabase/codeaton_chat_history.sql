-- Account-scoped Codeaton conversation history.
-- Safe to run repeatedly in the Supabase SQL Editor.

create table if not exists public.codeaton_chats (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]'::jsonb,
  mode text not null default 'chat',
  model text not null default 'openai/gpt-5.4-nano',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint codeaton_chats_title_length check (char_length(title) between 1 and 80),
  constraint codeaton_chats_messages_array check (jsonb_typeof(messages) = 'array')
);

create index if not exists idx_codeaton_chats_user_updated
  on public.codeaton_chats (user_id, updated_at desc);

alter table public.codeaton_chats enable row level security;

drop policy if exists "Users can create their own Codeaton chats" on public.codeaton_chats;
drop policy if exists "Users can view their own Codeaton chats" on public.codeaton_chats;
drop policy if exists "Users can update their own Codeaton chats" on public.codeaton_chats;
drop policy if exists "Users can delete their own Codeaton chats" on public.codeaton_chats;

create policy "Users can create their own Codeaton chats"
  on public.codeaton_chats
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can view their own Codeaton chats"
  on public.codeaton_chats
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can update their own Codeaton chats"
  on public.codeaton_chats
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own Codeaton chats"
  on public.codeaton_chats
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.codeaton_chats to authenticated;
