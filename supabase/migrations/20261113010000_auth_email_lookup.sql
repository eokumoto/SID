-- Private email-existence lookup for SID's automatic login/signup routing.
-- This deliberately exposes only a yes/no answer through the application route.
-- Browser roles cannot query auth.users or execute this function directly.
create table public.auth_email_lookup_limits (
  client_key text not null check (length(client_key) = 64),
  window_start timestamptz not null,
  attempts integer not null check (attempts between 1 and 30),
  primary key (client_key, window_start)
);
create index auth_email_lookup_limits_window on public.auth_email_lookup_limits (window_start);
alter table public.auth_email_lookup_limits enable row level security;
revoke all on public.auth_email_lookup_limits from public, anon, authenticated;
grant all on public.auth_email_lookup_limits to service_role;

create function public.lookup_auth_email(input_email text, client_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lookup_window timestamptz := to_timestamp(floor(extract(epoch from current_timestamp) / 300) * 300);
  account_exists boolean;
  retry_seconds integer;
begin
  if input_email is null or length(btrim(input_email)) not between 3 and 254
     or client_key_hash is null or client_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_lookup_input';
  end if;

  delete from public.auth_email_lookup_limits
    where window_start < lookup_window - interval '1 hour';

  insert into public.auth_email_lookup_limits (client_key, window_start, attempts)
    values (client_key_hash, lookup_window, 1)
    on conflict (client_key, window_start) do update
      set attempts = auth_email_lookup_limits.attempts + 1
      where auth_email_lookup_limits.attempts < 30;

  if not found then
    retry_seconds := greatest(1, ceil(extract(epoch from lookup_window + interval '5 minutes' - current_timestamp))::integer);
    return jsonb_build_object('limited', true, 'retry_after', retry_seconds);
  end if;

  select exists (
    select 1 from auth.users
    where lower(email) = lower(btrim(input_email)) and deleted_at is null
  ) into account_exists;

  return jsonb_build_object('limited', false, 'exists', account_exists);
end;
$$;
revoke all on function public.lookup_auth_email(text, text) from public, anon, authenticated;
grant execute on function public.lookup_auth_email(text, text) to service_role;
