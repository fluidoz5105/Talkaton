-- Allow the confirmed Owner Alt Account to review Talkaton requests.
-- Safe to run repeatedly after beta_requests.sql.

create or replace function public.is_talkaton_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users
    where id = auth.uid()
      and email_confirmed_at is not null
      and lower(email) in (
        'supportaton@gmail.com',
        'kantertal1@gmail.com',
        'donotuseunlessyouaretalkanter@gmail.com'
      )
  );
$$;

revoke all on function public.is_talkaton_reviewer() from public, anon;
grant execute on function public.is_talkaton_reviewer() to authenticated;

drop policy if exists "Support and owner can view all requests" on public.beta_requests;
drop policy if exists "Support and owner can review requests" on public.beta_requests;

create policy "Support and owner can view all requests"
  on public.beta_requests
  for select
  to authenticated
  using (public.is_talkaton_reviewer());

create policy "Support and owner can review requests"
  on public.beta_requests
  for update
  to authenticated
  using (public.is_talkaton_reviewer())
  with check (public.is_talkaton_reviewer());
