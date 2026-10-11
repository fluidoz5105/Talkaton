-- Run this once in the Supabase SQL editor for the Talkaton project.
-- The public counter is based on unique, confirmed accounts instead of visits.

create table if not exists public.talkaton_visitors (
  visitor_id uuid primary key,
  first_seen_at timestamptz not null default now()
);

alter table public.talkaton_visitors enable row level security;

revoke all on table public.talkaton_visitors from public, anon, authenticated;

create or replace function public.record_unique_visit(p_visitor_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  visitor_total bigint;
begin
  insert into public.talkaton_visitors (visitor_id)
  values (p_visitor_id)
  on conflict (visitor_id) do nothing;

  select count(*) into visitor_total
  from public.talkaton_visitors;

  return visitor_total;
end;
$$;

revoke all on function public.record_unique_visit(uuid) from public;
grant execute on function public.record_unique_visit(uuid) to anon, authenticated;

create or replace function public.get_real_member_count()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::bigint
  from auth.users
  where email_confirmed_at is not null
    and deleted_at is null
    and not coalesce(is_anonymous, false)
    and coalesce(lower(raw_user_meta_data ->> 'is_bot'), 'false') not in ('true', '1', 'yes')
    and coalesce(lower(raw_user_meta_data ->> 'user_type'), 'human') <> 'bot';
$$;

revoke all on function public.get_real_member_count() from public;
grant execute on function public.get_real_member_count() to anon, authenticated;
