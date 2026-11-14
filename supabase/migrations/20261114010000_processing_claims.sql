-- Claim processing and quota together; browser roles may only insert queued input.
alter table public.documents
  add column processing_started_at timestamptz,
  add column attempt_id uuid;
alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('queued', 'processing', 'ready', 'failed'));
alter table public.documents alter column status set default 'queued';

drop policy "own documents" on public.documents;
create policy "read own documents" on public.documents for select to authenticated
  using (user_id = auth.uid());
create policy "insert own queued documents" on public.documents for insert to authenticated
  with check (user_id = auth.uid() and status = 'queued'
    and image_path = user_id::text || '/' || id::text || '.jpg');
create policy "delete own documents" on public.documents for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.documents from anon, authenticated;
grant select, delete on public.documents to authenticated;
grant insert (id, image_path) on public.documents to authenticated;
grant all on public.documents to service_role;

create function public.claim_scan(document_id uuid, owner_id uuid, max_scans integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  doc public.documents%rowtype;
  used integer;
  usage_day date := (now() at time zone 'UTC')::date;
begin
  if max_scans is null or max_scans < 1 then
    raise exception 'invalid_daily_limit';
  end if;
  select * into doc from public.documents
    where id = document_id and user_id = owner_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if doc.status = 'ready' then return jsonb_build_object('document', to_jsonb(doc)); end if;
  if doc.image_path is null then return jsonb_build_object('error', 'original_unavailable'); end if;
  if doc.image_path <> owner_id::text || '/' || document_id::text || '.jpg' then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  if doc.status = 'processing' and doc.processing_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('error', 'already_processing');
  end if;
  insert into public.usage (user_id, day, scans) values (owner_id, usage_day, 1)
    on conflict (user_id, day) do update set scans = public.usage.scans + 1
      where public.usage.scans < max_scans
    returning scans into used;
  if not found then
    if doc.status = 'processing' then
      update public.documents set status = 'failed', error = 'timeout'
        where id = document_id and user_id = owner_id;
    end if;
    return jsonb_build_object('error', 'daily_limit');
  end if;
  update public.documents set status = 'processing', error = null,
    processing_started_at = now(), attempt_id = gen_random_uuid()
    where id = document_id and user_id = owner_id returning * into doc;
  return jsonb_build_object('document', to_jsonb(doc));
end;
$$;
revoke all on function public.claim_scan(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_scan(uuid, uuid, integer) to service_role;

update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id = 'scans';
