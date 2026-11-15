# SID Pro

The existing cream, peach, navy and dark themes are unchanged. The mockup's yellow background is not implemented.

Free includes 10 successful uploads per UTC day, the full reader, settings and saved history. Pro includes 150 successful uploads, Listen with voice/speed controls, and Summary. The upgrade dialog shows a proposed $3.99/month price. Purchasing is disabled and no Stripe integration or subscription is created.

## Supabase setup

Apply existing migrations in order, then review and manually apply `supabase/migrations/20261115000000_pro_features.sql`. This change is not deployed or applied automatically. The new processing code requires this migration; deploy them together.

The migration adds server-managed entitlements, an allowance ledger, a summary cache, and RPCs for atomic reservation/completion. A separate per-user limit allows 10 processing attempts per 10 minutes, including failed attempts; hitting this limit returns HTTP 429 with Retry-After and never consumes a daily upload credit. A slot is reserved while a scan runs and is charged only on successful completion. Failed, deleted, and expired processing attempts release their reservation. Deleting a successful scan does not refund its upload. Reopening a saved result never charges an upload. Slots and successful reads belong to the UTC day on which the attempt was admitted.

Existing successful scans from the current UTC day seed the new allowance ledger. The prior `usage` table and older processing functions remain for compatibility but are not used by the new processing route. `DAILY_LIMIT` is no longer used; the limits (10/150) are defined in the new migration.

Until Stripe is connected, an administrator can grant Pro using a verified user id from Supabase Authentication:

```sql
insert into public.account_entitlements (user_id, plan, expires_at)
values ('REPLACE_WITH_USER_UUID', 'pro', null)
on conflict (user_id) do update set plan = excluded.plan, expires_at = excluded.expires_at;
```

Set `plan = 'free'`, or set `expires_at` in the past, to remove access. Browsers cannot write entitlements, change quota, or call the privileged allowance RPCs. Anonymous users remain Free unless an administrator explicitly changes their entitlement. Their quota is tied to their anonymous Supabase user id, not an IP address or device fingerprint.

## Environment

The existing server-only Supabase key (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`) is required. Gemini Summary uses the existing `GEMINI_API_KEY` and image-capable `GEMINI_MODEL`. Listen uses the existing `GOOGLE_TTS_API_KEY` with Google Cloud Text-to-Speech enabled. No new API keys or packages are required.

Missing migrations or unavailable account data display an unavailable allowance rather than inventing a quota or granting Pro. API endpoints independently verify identity and Pro entitlement. Summary fetches the caller's own saved transcription; clients cannot submit arbitrary text to the Gemini Summary endpoint.

Listen uses named Google voices with SSML word marks for highlighting. Changing speed adjusts playback rate; changing voice restarts playback with the selected voice. Audio is fetched in bounded chunks. If cloud speech is unavailable, Pro users can use their device's available English voices; a notice explains the fallback. Device voices may sound different, and word boundary support depends on the browser. The player supports pause/resume, progress, close, and cleanup on navigation.

Summary keeps the full transcription on screen. It produces 3–5 bullets and checks protected dates, times, numbers, prices, and candidate names before returning a result. These checks do not prove semantic accuracy. Menus, lists, schedules, and documents under 80 words receive a short explanation instead. Classification is conservative and heuristic. Summaries are cached by document and source hash. A failed summary never changes or charges an upload. Close and reopen Summary to retry a transient failure.

## Review previews

All preview states are visibly labeled Sample and do not grant real Pro access or run real uploads:

- `/?preview=reader`: Free reader with Pro feature buttons.
- `/?preview=pro`: Pro reader with a sample housing summary.
- `/?preview=pro-menu`: Pro menu and summary explanation.
- `/?preview=pro-settings`: Pro Settings.
- `/?preview=pro-home`: Pro home counter.
- `/?preview=limit`: exhausted Free allowance.
- `/?preview=pro-limit`: exhausted Pro allowance.
- `/?preview=upgrade`: upgrade dialog.

## Verification

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
The tests use local mocks/PGlite, not hosted data. Live Stripe purchases are intentionally unavailable. Hosted migrations, entitlements, Google voices, and Gemini summaries must be checked separately after configuration.
