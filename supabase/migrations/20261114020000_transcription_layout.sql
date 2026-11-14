-- Optional image-relative line positions for the readable photo overlay.
-- Existing scans retain their saved OCR and stay readable without geometry.
alter table public.documents
  add column if not exists text_regions jsonb not null default '[]'::jsonb;
