-- Add the Talkaton Owner account to the private beta approval queue.
-- Safe to run after beta_requests.sql.

drop policy if exists "Support can view all requests" on public.beta_requests;
drop policy if exists "Support can review requests" on public.beta_requests;
drop policy if exists "Support and owner can view all requests" on public.beta_requests;
drop policy if exists "Support and owner can review requests" on public.beta_requests;

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

create policy "Support and owner can view all requests"
  on public.beta_requests
  for select
  using (public.is_talkaton_reviewer());

create policy "Support and owner can review requests"
  on public.beta_requests
  for update
  using (public.is_talkaton_reviewer())
  with check (public.is_talkaton_reviewer());
