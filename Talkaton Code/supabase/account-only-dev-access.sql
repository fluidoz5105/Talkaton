-- Dev Access requests require an authenticated Talkaton account.
-- Beta approval is not required.

create or replace function public.submit_dev_access_request(
  p_requester_name text,
  p_user_email text,
  p_title text,
  p_details text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Log in to a confirmed Talkaton account before requesting Dev Access.';
  end if;

  v_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));

  if char_length(trim(coalesce(p_requester_name, ''))) not between 1 and 80 then
    raise exception 'Enter your name.';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(v_email) > 160 then
    raise exception 'Your confirmed account needs a valid email address.';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 120 then
    raise exception 'Enter a Dev Access request title.';
  end if;
  if char_length(trim(coalesce(p_details, ''))) not between 10 and 2000 then
    raise exception 'Explain why you need Dev Access.';
  end if;
  if exists (
    select 1
    from public.beta_requests
    where user_id = auth.uid()
      and feature_key = 'dev_access'
      and status = 'pending'
  ) then
    raise exception 'A Dev Access request for this account is already pending.';
  end if;

  insert into public.beta_requests (
    user_id,
    user_email,
    requester_name,
    feature_key,
    title,
    details
  )
  values (
    auth.uid(),
    v_email,
    trim(p_requester_name),
    'dev_access',
    trim(p_title),
    trim(p_details)
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.submit_dev_access_request(text, text, text, text) from public;
revoke execute on function public.submit_dev_access_request(text, text, text, text) from anon;
grant execute on function public.submit_dev_access_request(text, text, text, text) to authenticated;
