-- Keep the public Beta page's request history private to each Talkaton account.
-- Owner and Support retain their separate all-requests policies for the approval inbox.

update public.beta_requests as request
set user_id = account.id
from auth.users as account
where request.user_id is null
  and account.email is not null
  and lower(request.user_email) = lower(account.email);

drop policy if exists "Users can view their own requests" on public.beta_requests;

create policy "Users can view their own requests"
  on public.beta_requests
  for select
  to authenticated
  using (auth.uid() = user_id);
