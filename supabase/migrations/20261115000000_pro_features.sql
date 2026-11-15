-- Pro entitlements are assigned by an administrator until billing is connected.
-- Apply after the existing processing/layout migrations. No payment data is stored.
begin;

create table public.account_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  expires_at timestamptz
);
alter table public.account_entitlements enable row level security;
revoke all on public.account_entitlements from public, anon, authenticated;
grant all on public.account_entitlements to service_role;

create table public.upload_allowances (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  successes integer not null default 0 check (successes >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  primary key (user_id, day)
);
alter table public.upload_allowances enable row level security;
revoke all on public.upload_allowances from public, anon, authenticated;
grant all on public.upload_allowances to service_role;

-- A separate safety throttle counts attempts, including failures. It never
-- changes the user's daily successful-upload allowance.
create table public.scan_attempt_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null check (attempts between 1 and 11)
);
alter table public.scan_attempt_limits enable row level security;
revoke all on public.scan_attempt_limits from public, anon, authenticated;
grant all on public.scan_attempt_limits to service_role;

-- Seed today's successful, still-existing scans. Future usage survives history deletion.
insert into public.upload_allowances (user_id, day, successes)
select user_id, (created_at at time zone 'UTC')::date, count(*)::integer
from public.documents where status = 'ready'
  and (created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date
group by user_id, (created_at at time zone 'UTC')::date;

alter table public.documents add column allowance_day date,
  add column allowance_reserved boolean not null default false;

create table public.scan_summaries (
  document_id uuid primary key references public.documents(id) on delete cascade,
  source_hash text not null,
  bullets jsonb not null check (jsonb_typeof(bullets) = 'array')
);
alter table public.scan_summaries enable row level security;
revoke all on public.scan_summaries from public, anon, authenticated;
grant all on public.scan_summaries to service_role;

create function public.get_upload_allowance(owner_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tier text := 'free';
  daily_max integer;
  used integer := 0;
  pending integer := 0;
  today date := (now() at time zone 'UTC')::date;
  expired public.documents%rowtype;
begin
  -- A terminated worker cannot hold an allowance indefinitely. SKIP LOCKED
  -- avoids racing completion or blocking another request for the same user.
  for expired in select * from public.documents where user_id = owner_id
    and allowance_reserved and processing_started_at <= now() - interval '2 minutes'
    order by id for update skip locked
  loop
    update public.upload_allowances set reserved = greatest(0, reserved - 1)
      where user_id = owner_id and day = expired.allowance_day;
    update public.documents set allowance_reserved = false, status = 'failed', error = 'timeout'
      where id = expired.id;
  end loop;
  select plan into tier from public.account_entitlements
    where user_id = owner_id and (expires_at is null or expires_at > now());
  tier := coalesce(tier, 'free');
  daily_max := case when tier = 'pro' then 150 else 10 end;
  select successes, reserved into used, pending from public.upload_allowances
    where user_id = owner_id and day = today;
  return jsonb_build_object('plan', tier, 'limit', daily_max, 'used', coalesce(used, 0),
    'remaining', greatest(0, daily_max - coalesce(used, 0) - coalesce(pending, 0)),
    'resetsAt', ((today + 1)::timestamp at time zone 'UTC'));
end;
$$;

create function public.claim_pro_scan(document_id uuid, owner_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  doc public.documents%rowtype;
  allowance jsonb;
  reserved_count integer;
  attempt_count integer;
  attempt_window timestamptz;
  today date := (now() at time zone 'UTC')::date;
begin
  allowance := public.get_upload_allowance(owner_id);
  select * into doc from public.documents where id = document_id and user_id = owner_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if doc.status = 'ready' then return jsonb_build_object('document', to_jsonb(doc)); end if;
  if doc.image_path is null then return jsonb_build_object('error', 'original_unavailable'); end if;
  if doc.image_path <> owner_id::text || '/' || document_id::text || '.jpg' then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  if doc.status = 'processing' and doc.processing_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('error', 'already_processing');
  end if;
  if (allowance->>'remaining')::integer <= 0 then
    return jsonb_build_object('error', 'daily_limit');
  end if;
  insert into public.scan_attempt_limits (user_id, window_start, attempts) values (owner_id, now(), 1)
    on conflict (user_id) do update set
      window_start = case when scan_attempt_limits.window_start <= now() - interval '10 minutes'
        then now() else scan_attempt_limits.window_start end,
      attempts = case when scan_attempt_limits.window_start <= now() - interval '10 minutes'
        then 1 else least(scan_attempt_limits.attempts + 1, 11) end
    returning attempts, window_start into attempt_count, attempt_window;
  if attempt_count > 10 then
    return jsonb_build_object('error', 'rate_limit', 'retry_after',
      greatest(1, ceil(extract(epoch from attempt_window + interval '10 minutes' - now()))::integer));
  end if;
  insert into public.upload_allowances (user_id, day, reserved) values (owner_id, today, 1)
    on conflict (user_id, day) do update set reserved = public.upload_allowances.reserved + 1
    where public.upload_allowances.successes + public.upload_allowances.reserved < (allowance->>'limit')::integer
    returning reserved into reserved_count;
  if not found then return jsonb_build_object('error', 'daily_limit'); end if;
  update public.documents set status = 'processing', error = null,
    processing_started_at = now(), attempt_id = gen_random_uuid(),
    allowance_day = today, allowance_reserved = true
    where id = document_id and user_id = owner_id returning * into doc;
  return jsonb_build_object('document', to_jsonb(doc));
end;
$$;

create function public.finish_pro_scan(document_id uuid, owner_id uuid, expected_attempt uuid, outcome jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare doc public.documents%rowtype;
begin
  select * into doc from public.documents where id = document_id and user_id = owner_id for update;
  if not found or doc.status <> 'processing' or doc.attempt_id is distinct from expected_attempt
    or not doc.allowance_reserved then return jsonb_build_object('error', 'superseded'); end if;
  if nullif(outcome->>'error', '') is null and coalesce(length(outcome->>'ocr_text'), 0) = 0 then
    raise exception 'missing_transcription';
  end if;
  update public.upload_allowances set reserved = greatest(0, reserved - 1),
    successes = successes + case when nullif(outcome->>'error', '') is not null then 0 else 1 end
    where user_id = owner_id and day = doc.allowance_day;
  if nullif(outcome->>'error', '') is not null then
    update public.documents set status = 'failed', error = outcome->>'error', allowance_reserved = false
      where id = document_id returning * into doc;
  else
    update public.documents set status = 'ready', error = null, allowance_reserved = false,
      title = outcome->>'title', ocr_text = outcome->>'ocr_text', plain_text = outcome->>'ocr_text',
      gemini_source_text = outcome->>'gemini_source_text', ocr_source = outcome->>'ocr_source',
      flags = coalesce(outcome->'flags', '[]'::jsonb), key_terms = coalesce(outcome->'key_terms', '[]'::jsonb),
      warnings = coalesce(outcome->'warnings', '[]'::jsonb), text_regions = coalesce(outcome->'text_regions', '[]'::jsonb)
      where id = document_id returning * into doc;
  end if;
  return jsonb_build_object('document', to_jsonb(doc));
end;
$$;

create function public.release_deleted_scan_allowance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.allowance_reserved then
    update public.upload_allowances set reserved = greatest(0, reserved - 1)
      where user_id = old.user_id and day = old.allowance_day;
  end if;
  return old;
end;
$$;
create trigger release_deleted_scan_allowance after delete on public.documents
  for each row execute function public.release_deleted_scan_allowance();

revoke all on function public.get_upload_allowance(uuid) from public, anon, authenticated;
revoke all on function public.claim_pro_scan(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_pro_scan(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.release_deleted_scan_allowance() from public, anon, authenticated;
grant execute on function public.get_upload_allowance(uuid) to service_role;
grant execute on function public.claim_pro_scan(uuid, uuid) to service_role;
grant execute on function public.finish_pro_scan(uuid, uuid, uuid, jsonb) to service_role;

commit;
