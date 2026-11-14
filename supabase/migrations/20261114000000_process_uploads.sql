-- Temporary extraction uploads only. No document/history rows are created.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'process-uploads', 'process-uploads', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
);

create policy "insert own temporary photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'process-uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic)$'
  );

create policy "read own temporary photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'process-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Used by the route's finally block and browser fallback after an interrupted request.
create policy "delete own temporary photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'process-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- One row per user. No image, text, email, key, or bearer token is stored here.
create table public.photo_process_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null check (requests between 1 and 11)
);
alter table public.photo_process_limits enable row level security;
revoke all on public.photo_process_limits from public, anon, authenticated;

-- Authenticated guests and regular users share the same limit. Callers cannot
-- supply another user's id, choose the quota, or reset their counter.
create function public.reserve_photo_process()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  checked_at timestamptz := clock_timestamp();
  current_window timestamptz;
  current_requests integer;
begin
  if caller is null then
    raise exception 'authentication_required';
  end if;

  insert into public.photo_process_limits (user_id, window_start, requests)
  values (caller, checked_at, 1)
  on conflict (user_id) do update set
    window_start = case when photo_process_limits.window_start <= checked_at - interval '10 minutes'
      then checked_at else photo_process_limits.window_start end,
    requests = case when photo_process_limits.window_start <= checked_at - interval '10 minutes'
      then 1 else least(photo_process_limits.requests + 1, 11) end
  returning window_start, requests into current_window, current_requests;

  return jsonb_build_object(
    'allowed', current_requests <= 10,
    'retry_after', case when current_requests <= 10 then 0
      else greatest(1, ceil(extract(epoch from current_window + interval '10 minutes' - checked_at))::integer) end
  );
end;
$$;
revoke all on function public.reserve_photo_process() from public, anon, authenticated;
grant execute on function public.reserve_photo_process() to authenticated;

commit;
