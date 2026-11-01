-- Run once in the Talkaton Supabase SQL editor.
-- Counts unique confirmed accounts and enforces guest limits with a server-created,
-- one-way network fingerprint. Raw IP addresses and browser details are never stored.

create table if not exists public.guest_daily_usage (
  guest_key text not null
    check (guest_key ~ '^[0-9a-f]{64}$'),
  usage_date date not null default (timezone('utc', now()))::date,
  feature text not null
    check (feature in ('messages', 'images', 'searches', 'voice')),
  request_count integer not null default 0
    check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (guest_key, usage_date, feature)
);

alter table public.guest_daily_usage
  drop constraint if exists guest_daily_usage_feature_check;
alter table public.guest_daily_usage
  add constraint guest_daily_usage_feature_check
  check (feature in ('messages', 'images', 'searches', 'voice'));

alter table public.guest_daily_usage enable row level security;
revoke all on table public.guest_daily_usage from public, anon, authenticated;

create or replace function public.consume_guest_usage(
  p_guest_key text,
  p_feature text,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (timezone('utc', now()))::date;
  v_used integer;
begin
  if p_guest_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid guest key';
  end if;
  if p_feature not in ('messages', 'images', 'searches', 'voice') then
    raise exception 'Invalid usage feature';
  end if;
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'Invalid usage limit';
  end if;

  delete from public.guest_daily_usage
  where usage_date < v_today - 7;

  insert into public.guest_daily_usage (
    guest_key,
    usage_date,
    feature,
    request_count,
    updated_at
  )
  values (
    lower(p_guest_key),
    v_today,
    p_feature,
    1,
    now()
  )
  on conflict (guest_key, usage_date, feature)
  do update
    set request_count = public.guest_daily_usage.request_count + 1,
        updated_at = now()
    where public.guest_daily_usage.request_count < p_limit
  returning request_count into v_used;

  if v_used is null then
    select request_count
      into v_used
    from public.guest_daily_usage
    where guest_key = lower(p_guest_key)
      and usage_date = v_today
      and feature = p_feature;

    return jsonb_build_object(
      'allowed', false,
      'used', coalesce(v_used, p_limit),
      'remaining', 0
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'remaining', greatest(0, p_limit - v_used)
  );
end;
$$;

revoke all on function public.consume_guest_usage(text, text, integer) from public;
grant execute on function public.consume_guest_usage(text, text, integer) to anon, authenticated;

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
