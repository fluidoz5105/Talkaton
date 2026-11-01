-- Talkaton enterprise workspaces, shared repository, developer keys, and GitHub connections.
-- Apply once in the Supabase SQL Editor. This migration is idempotent where practical.

do $$
begin
  create type public.workspace_role as enum ('admin', 'editor', 'viewer');
exception when duplicate_object then null;
end $$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'viewer',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) between 1 and 200),
  created_by uuid not null references auth.users(id) on delete restrict,
  model text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table if not exists public.workspace_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  chat_id uuid not null,
  author_user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_messages_chat_workspace_fk
    foreign key (chat_id, workspace_id)
    references public.workspace_chats(id, workspace_id)
    on delete cascade
);

create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_path text not null check (char_length(storage_path) between 38 and 800),
  display_name text not null check (char_length(display_name) between 1 and 255),
  content_type text check (content_type is null or char_length(content_type) <= 160),
  size_bytes bigint not null default 0 check (size_bytes between 0 and 52428800),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, storage_path)
);

create index if not exists idx_workspace_members_user on public.workspace_members (user_id, workspace_id);
create index if not exists idx_workspace_chats_recent on public.workspace_chats (workspace_id, updated_at desc);
create index if not exists idx_workspace_messages_chat on public.workspace_messages (chat_id, created_at, id);
create index if not exists idx_workspace_files_recent on public.workspace_files (workspace_id, updated_at desc);

create or replace function public.is_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id
  );
$$;

create or replace function public.has_workspace_role(
  p_workspace_id uuid,
  p_roles public.workspace_role[],
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = p_user_id
      and role = any(p_roles)
  );
$$;

revoke all on function public.is_workspace_member(uuid, uuid) from public;
revoke all on function public.has_workspace_role(uuid, public.workspace_role[], uuid) from public;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[], uuid) to authenticated, service_role;

create or replace function public.initialize_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (new.id, new.owner_user_id, 'admin'::public.workspace_role, new.owner_user_id)
  on conflict (workspace_id, user_id) do update set role = 'admin'::public.workspace_role;
  return new;
end;
$$;

create or replace function public.protect_workspace_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'workspaces' then
    if tg_op = 'UPDATE' and new.owner_user_id <> old.owner_user_id then
      raise exception 'Workspace ownership cannot be reassigned directly.';
    end if;
  elsif tg_table_name = 'workspace_members' then
    if (tg_op = 'DELETE' or new.role <> 'admin'::public.workspace_role)
      and exists (
        select 1 from public.workspaces
        where id = old.workspace_id and owner_user_id = old.user_id
      ) then
      raise exception 'The workspace owner must remain an admin.';
    end if;
    if old.role = 'admin'::public.workspace_role
      and (tg_op = 'DELETE' or new.role <> 'admin'::public.workspace_role)
      and exists (select 1 from public.workspaces where id = old.workspace_id)
      and not exists (
        select 1 from public.workspace_members
        where workspace_id = old.workspace_id
          and user_id <> old.user_id
          and role = 'admin'::public.workspace_role
      ) then
      raise exception 'A workspace must always have at least one admin.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_workspace_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trigger_initialize_workspace_owner on public.workspaces;
create trigger trigger_initialize_workspace_owner
  after insert on public.workspaces
  for each row execute function public.initialize_workspace_owner();

drop trigger if exists trigger_protect_workspace_owner on public.workspaces;
create trigger trigger_protect_workspace_owner
  before update on public.workspaces
  for each row execute function public.protect_workspace_invariants();

drop trigger if exists trigger_protect_workspace_admins on public.workspace_members;
create trigger trigger_protect_workspace_admins
  before update or delete on public.workspace_members
  for each row execute function public.protect_workspace_invariants();

drop trigger if exists trigger_touch_workspaces on public.workspaces;
create trigger trigger_touch_workspaces before update on public.workspaces
  for each row execute function public.touch_workspace_updated_at();
drop trigger if exists trigger_touch_workspace_members on public.workspace_members;
create trigger trigger_touch_workspace_members before update on public.workspace_members
  for each row execute function public.touch_workspace_updated_at();
drop trigger if exists trigger_touch_workspace_chats on public.workspace_chats;
create trigger trigger_touch_workspace_chats before update on public.workspace_chats
  for each row execute function public.touch_workspace_updated_at();
drop trigger if exists trigger_touch_workspace_messages on public.workspace_messages;
create trigger trigger_touch_workspace_messages before update on public.workspace_messages
  for each row execute function public.touch_workspace_updated_at();
drop trigger if exists trigger_touch_workspace_files on public.workspace_files;
create trigger trigger_touch_workspace_files before update on public.workspace_files
  for each row execute function public.touch_workspace_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_chats enable row level security;
alter table public.workspace_messages enable row level security;
alter table public.workspace_files enable row level security;

drop policy if exists "Members view workspaces" on public.workspaces;
drop policy if exists "Users create workspaces" on public.workspaces;
drop policy if exists "Admins update workspaces" on public.workspaces;
drop policy if exists "Admins delete workspaces" on public.workspaces;
create policy "Members view workspaces" on public.workspaces for select to authenticated
  using (public.is_workspace_member(id, auth.uid()));
create policy "Users create workspaces" on public.workspaces for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy "Admins update workspaces" on public.workspaces for update to authenticated
  using (public.has_workspace_role(id, array['admin']::public.workspace_role[], auth.uid()))
  with check (public.has_workspace_role(id, array['admin']::public.workspace_role[], auth.uid()));
create policy "Admins delete workspaces" on public.workspaces for delete to authenticated
  using (public.has_workspace_role(id, array['admin']::public.workspace_role[], auth.uid()));

drop policy if exists "Members view membership" on public.workspace_members;
drop policy if exists "Admins add members" on public.workspace_members;
drop policy if exists "Admins update members" on public.workspace_members;
drop policy if exists "Admins remove members" on public.workspace_members;
create policy "Members view membership" on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Admins add members" on public.workspace_members for insert to authenticated
  with check (
    invited_by = auth.uid()
    and public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[], auth.uid())
  );
create policy "Admins update members" on public.workspace_members for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[], auth.uid()))
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[], auth.uid()));
create policy "Admins remove members" on public.workspace_members for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[], auth.uid()));

drop policy if exists "Members view shared chats" on public.workspace_chats;
drop policy if exists "Editors create shared chats" on public.workspace_chats;
drop policy if exists "Editors update shared chats" on public.workspace_chats;
drop policy if exists "Editors delete shared chats" on public.workspace_chats;
create policy "Members view shared chats" on public.workspace_chats for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Editors create shared chats" on public.workspace_chats for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid())
  );
create policy "Editors update shared chats" on public.workspace_chats for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()))
  with check (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()));
create policy "Editors delete shared chats" on public.workspace_chats for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()));

drop policy if exists "Members view shared messages" on public.workspace_messages;
drop policy if exists "Editors create shared messages" on public.workspace_messages;
drop policy if exists "Editors update shared messages" on public.workspace_messages;
drop policy if exists "Editors delete shared messages" on public.workspace_messages;
create policy "Members view shared messages" on public.workspace_messages for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Editors create shared messages" on public.workspace_messages for insert to authenticated
  with check (
    (author_user_id is null or author_user_id = auth.uid())
    and public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid())
  );
create policy "Editors update shared messages" on public.workspace_messages for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()))
  with check (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()));
create policy "Editors delete shared messages" on public.workspace_messages for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()));

drop policy if exists "Members view shared files" on public.workspace_files;
drop policy if exists "Editors register shared files" on public.workspace_files;
drop policy if exists "Editors update shared files" on public.workspace_files;
drop policy if exists "Editors delete shared files" on public.workspace_files;
create policy "Members view shared files" on public.workspace_files for select to authenticated
  using (public.is_workspace_member(workspace_id, auth.uid()));
create policy "Editors register shared files" on public.workspace_files for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and storage_path like workspace_id::text || '/%'
    and public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid())
  );
create policy "Editors update shared files" on public.workspace_files for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()))
  with check (
    storage_path like workspace_id::text || '/%'
    and public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid())
  );
create policy "Editors delete shared files" on public.workspace_files for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin','editor']::public.workspace_role[], auth.uid()));

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.workspace_chats to authenticated;
grant select, insert, update, delete on public.workspace_messages to authenticated;
grant select, insert, update, delete on public.workspace_files to authenticated;

create or replace function public.workspace_invite_member(
  p_workspace_id uuid,
  p_email text,
  p_role public.workspace_role default 'viewer'::public.workspace_role
)
returns table (workspace_id uuid, user_id uuid, role public.workspace_role, joined_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_user_id uuid;
begin
  if not public.has_workspace_role(
    p_workspace_id,
    array['admin']::public.workspace_role[],
    auth.uid()
  ) then
    raise exception 'Only workspace admins can invite members.';
  end if;

  select id into invited_user_id
  from auth.users
  where lower(email) = lower(trim(p_email))
    and email_confirmed_at is not null
  limit 1;

  if invited_user_id is null then
    raise exception 'No confirmed Talkaton account uses that email address.';
  end if;

  return query
  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (p_workspace_id, invited_user_id, p_role, auth.uid())
  on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        updated_at = now()
  returning workspace_members.workspace_id, workspace_members.user_id,
    workspace_members.role, workspace_members.joined_at;
end;
$$;

revoke all on function public.workspace_invite_member(uuid,text,public.workspace_role) from public, anon;
grant execute on function public.workspace_invite_member(uuid,text,public.workspace_role) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('workspace-files', 'workspace-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.workspace_id_from_storage_path(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
grant execute on function public.workspace_id_from_storage_path(text) to authenticated, service_role;

drop policy if exists "Members download workspace files" on storage.objects;
drop policy if exists "Editors upload workspace files" on storage.objects;
drop policy if exists "Editors replace workspace files" on storage.objects;
drop policy if exists "Editors remove workspace files" on storage.objects;
create policy "Members download workspace files" on storage.objects for select to authenticated
  using (
    bucket_id = 'workspace-files'
    and public.is_workspace_member(public.workspace_id_from_storage_path(name), auth.uid())
  );
create policy "Editors upload workspace files" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'workspace-files'
    and public.has_workspace_role(
      public.workspace_id_from_storage_path(name),
      array['admin','editor']::public.workspace_role[],
      auth.uid()
    )
  );
create policy "Editors replace workspace files" on storage.objects for update to authenticated
  using (
    bucket_id = 'workspace-files'
    and public.has_workspace_role(
      public.workspace_id_from_storage_path(name),
      array['admin','editor']::public.workspace_role[],
      auth.uid()
    )
  )
  with check (
    bucket_id = 'workspace-files'
    and public.has_workspace_role(
      public.workspace_id_from_storage_path(name),
      array['admin','editor']::public.workspace_role[],
      auth.uid()
    )
  );
create policy "Editors remove workspace files" on storage.objects for delete to authenticated
  using (
    bucket_id = 'workspace-files'
    and public.has_workspace_role(
      public.workspace_id_from_storage_path(name),
      array['admin','editor']::public.workspace_role[],
      auth.uid()
    )
  );

create table if not exists public.developer_api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_prefix text not null check (char_length(key_prefix) between 8 and 24),
  scopes text[] not null check (
    cardinality(scopes) between 1 and 8
    and scopes <@ array[
      'agents:read','agents:write','chat:read','chat:write',
      'files:read','files:write','workspace:read','workspace:write'
    ]::text[]
  ),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_developer_api_keys_owner on public.developer_api_keys (owner_user_id, created_at desc);
create index if not exists idx_developer_api_keys_active_hash on public.developer_api_keys (key_hash)
  where revoked_at is null;
alter table public.developer_api_keys enable row level security;
revoke all on public.developer_api_keys from anon, authenticated;

create or replace function public.platform_create_developer_api_key(
  p_owner_user_id uuid,
  p_name text,
  p_key_hash text,
  p_key_prefix text,
  p_scopes text[],
  p_workspace_id uuid default null,
  p_expires_at timestamptz default null
)
returns table (
  id uuid, name text, key_prefix text, scopes text[], workspace_id uuid,
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_user_id::text, 81284901)
  );
  if (
    select count(*)
    from public.developer_api_keys as existing_key
    where existing_key.owner_user_id = p_owner_user_id
      and existing_key.revoked_at is null
      and (existing_key.expires_at is null or existing_key.expires_at > now())
  ) >= 25 then
    raise exception 'An account may have at most 25 active API keys.';
  end if;
  if p_workspace_id is not null and not public.has_workspace_role(
    p_workspace_id, array['admin']::public.workspace_role[], p_owner_user_id
  ) then
    raise exception 'Only workspace admins can create workspace API keys.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'API key expiration must be in the future.';
  end if;

  return query
  insert into public.developer_api_keys (
    owner_user_id, workspace_id, name, key_hash, key_prefix, scopes, expires_at
  ) values (
    p_owner_user_id, p_workspace_id, trim(p_name), p_key_hash, p_key_prefix, p_scopes, p_expires_at
  )
  returning developer_api_keys.id, developer_api_keys.name, developer_api_keys.key_prefix,
    developer_api_keys.scopes, developer_api_keys.workspace_id, developer_api_keys.last_used_at,
    developer_api_keys.expires_at, developer_api_keys.revoked_at, developer_api_keys.created_at,
    developer_api_keys.updated_at;
end;
$$;

create or replace function public.platform_roll_developer_api_key(
  p_old_key_id uuid,
  p_owner_user_id uuid,
  p_name text,
  p_key_hash text,
  p_key_prefix text,
  p_scopes text[],
  p_workspace_id uuid default null,
  p_expires_at timestamptz default null
)
returns table (
  id uuid, name text, key_prefix text, scopes text[], workspace_id uuid,
  last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.developer_api_keys
  where developer_api_keys.id = p_old_key_id
    and developer_api_keys.owner_user_id = p_owner_user_id
    and developer_api_keys.revoked_at is null
  for update;
  if not found then raise exception 'Active API key not found.'; end if;

  if p_workspace_id is not null and not public.has_workspace_role(
    p_workspace_id, array['admin']::public.workspace_role[], p_owner_user_id
  ) then
    raise exception 'Only workspace admins can create workspace API keys.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'API key expiration must be in the future.';
  end if;

  update public.developer_api_keys set revoked_at = now(), updated_at = now()
  where developer_api_keys.id = p_old_key_id;

  return query
  insert into public.developer_api_keys (
    owner_user_id, workspace_id, name, key_hash, key_prefix, scopes, expires_at
  ) values (
    p_owner_user_id, p_workspace_id, trim(p_name), p_key_hash, p_key_prefix, p_scopes, p_expires_at
  )
  returning developer_api_keys.id, developer_api_keys.name, developer_api_keys.key_prefix,
    developer_api_keys.scopes, developer_api_keys.workspace_id, developer_api_keys.last_used_at,
    developer_api_keys.expires_at, developer_api_keys.revoked_at, developer_api_keys.created_at,
    developer_api_keys.updated_at;
end;
$$;

create or replace function public.platform_authenticate_developer_api_key(
  p_key_hash text,
  p_required_scope text default null
)
returns table (key_id uuid, owner_user_id uuid, workspace_id uuid, scopes text[])
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.developer_api_keys
  set last_used_at = now(), updated_at = now()
  where key_hash = p_key_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and (p_required_scope is null or p_required_scope = any(developer_api_keys.scopes))
  returning developer_api_keys.id, developer_api_keys.owner_user_id,
    developer_api_keys.workspace_id, developer_api_keys.scopes;
end;
$$;

revoke all on function public.platform_create_developer_api_key(uuid,text,text,text,text[],uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.platform_roll_developer_api_key(uuid,uuid,text,text,text,text[],uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.platform_authenticate_developer_api_key(text,text) from public, anon, authenticated;
grant execute on function public.platform_create_developer_api_key(uuid,text,text,text,text[],uuid,timestamptz) to service_role;
grant execute on function public.platform_roll_developer_api_key(uuid,uuid,text,text,text,text[],uuid,timestamptz) to service_role;
grant execute on function public.platform_authenticate_developer_api_key(text,text) to service_role;

create table if not exists public.github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_user_id text not null,
  github_login text not null check (github_login ~ '^[A-Za-z0-9-]{1,39}$'),
  avatar_url text,
  encrypted_access_token text not null,
  granted_scopes text[] not null default '{}'::text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.github_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  return_path text not null default '/chat?github=connected',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_github_oauth_states_expiry on public.github_oauth_states (expires_at)
  where consumed_at is null;
alter table public.github_connections enable row level security;
alter table public.github_oauth_states enable row level security;
revoke all on public.github_connections from anon, authenticated;
revoke all on public.github_oauth_states from anon, authenticated;

-- Keep realtime shared chats opt-in but ready for connected clients.
do $$
begin
  alter publication supabase_realtime add table public.workspace_chats;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.workspace_messages;
exception when duplicate_object then null;
end $$;
