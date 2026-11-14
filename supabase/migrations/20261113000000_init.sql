-- Initial schema: documents, profiles, usage, scans bucket, RLS.
-- See docs/DATA_MODEL.md.

-- Tables
create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  title       text,
  image_path  text,
  ocr_text    text,
  plain_text  text,
  flags       jsonb not null default '[]'::jsonb,
  key_terms   jsonb not null default '[]'::jsonb,
  status      text not null default 'processing'
              check (status in ('processing', 'ready', 'failed')),
  error       text
);
create index documents_user_created on public.documents (user_id, created_at desc);

create table public.profiles (
  user_id   uuid primary key default auth.uid() references auth.users on delete cascade,
  settings  jsonb not null default '{}'::jsonb
);

create table public.usage (
  user_id  uuid not null references auth.users on delete cascade,
  day      date not null default current_date,
  scans    int  not null default 0,
  primary key (user_id, day)
);

-- Row-level security
alter table public.documents enable row level security;
alter table public.profiles  enable row level security;
alter table public.usage     enable row level security;

create policy "own documents" on public.documents
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own profile" on public.profiles
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- usage: read your own; no write policies, so only the service role can write.
create policy "read own usage" on public.usage
  for select to authenticated
  using (user_id = auth.uid());

-- Daily limit, called only by /api/process with the service role.
-- Returns true and bumps the count if the user is under the limit.
create or replace function public.bump_usage(uid uuid, max_scans int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into usage (user_id, day, scans) values (uid, current_date, 1)
  on conflict (user_id, day) do update set scans = usage.scans + 1
  returning scans into n;
  if n > max_scans then
    update usage set scans = scans - 1 where user_id = uid and day = current_date;
    return false;
  end if;
  return true;
end $$;
revoke execute on function public.bump_usage(uuid, int) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid, int) to service_role;

-- Storage
insert into storage.buckets (id, name, public) values ('scans', 'scans', false);

create policy "own scan files" on storage.objects
  for all to authenticated
  using (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'scans' and (storage.foldername(name))[1] = auth.uid()::text);
