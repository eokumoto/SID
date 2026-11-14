-- Fields written only by app/api/process with the service-role key.
alter table public.documents
  add column if not exists gemini_source_text text,
  add column if not exists ocr_source text check (ocr_source in ('gemini', 'vision')),
  add column if not exists warnings jsonb not null default '[]'::jsonb;
