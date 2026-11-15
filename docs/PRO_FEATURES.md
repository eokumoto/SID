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

The existing server-only Supabase key (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`) is required. Gemini Summary uses the existing `GEMINI_API_KEY` and image-capable `GEMINI_MODEL`. Listen uses `GOOGLE_TTS_API_KEY` (Google Cloud Text-to-Speech) when it is set; otherwise it uses Gemini speech generation with the existing `GEMINI_API_KEY` (model `gemini-3.1-flash-tts-preview`, override with `GEMINI_TTS_MODEL`). No new API keys or packages are required.

Missing migrations or unavailable account data display an unavailable allowance rather than inventing a quota or granting Pro. API endpoints independently verify identity and Pro entitlement. Summary fetches the caller's own saved transcription; clients cannot submit arbitrary text to the Gemini Summary endpoint.

Listen uses Google Chirp 3: HD voices (Calm = Achernar, Clear = Iapetus, Warm = Sulafat). Chirp 3: HD does not return word timepoints, so the reader estimates word timing from word length and punctuation once the audio length is known. If an HD request fails, the server retries with the older Neural2 voice and exact SSML word marks. Without a Cloud TTS key, the same three voices come from Gemini speech (WAV audio, free tier with daily limits; paid is about $1 per 1M input tokens and $20 per 1M audio tokens). Text is sent in ~600 character chunks so each clip stays under Vercel's 4.5 MB response limit. When a cloud voice fails, the notice names the reason (for example "no voice key set" or "daily voice limit reached"). Changing speed adjusts playback rate; changing voice restarts playback with the selected voice. Audio is fetched in bounded chunks. Cost: Chirp 3: HD is $30 per 1M characters after the free 1M characters per month (Neural2 was $16); results are cached per server instance. If cloud speech is unavailable, Pro users hear their device's best English voice: natural, premium and enhanced voices are preferred, and joke voices such as Bad News or Zarvox are skipped; a notice explains the fallback. Device voices may sound different, and word boundary support depends on the browser. The player supports pause/resume, progress, close, and cleanup on navigation.

Summary keeps the full transcription on screen. It produces 3–5 bullets and checks protected dates, times, numbers, prices, and candidate names before returning a result. These checks do not prove semantic accuracy. Menus, lists, schedules, and documents under 80 words receive a short explanation instead. Classification is conservative and heuristic. Summaries are cached by document and source hash. A failed summary never changes or charges an upload. Close and reopen Summary to retry a transient failure.

## Account page

The profile menu opens **Account**. Users can change their display name (saved as `display_name` in Supabase user metadata, because Google rewrites `name` on each sign-in), see their plan and renewal or end date, and cancel Pro.

- `GET /api/billing/subscription` returns the plan, entitlement expiry and the live Stripe subscription (falls back to the `stripe_subscriptions` row if Stripe is unreachable).
- `POST /api/billing/subscription` with `{ "action": "cancel" }` sets `cancel_at_period_end` in Stripe, so Pro stays until the paid period ends. `{ "action": "resume" }` undoes it. The webhook still grants and revokes the entitlement.
- `POST /api/billing/portal` opens the Stripe Customer Portal for card changes, invoices and cancellation, and returns to `/?view=account`.

All three verify the Supabase bearer token and act only on the caller's own `stripe_subscriptions` row. Keys come from `STRIPE_SECRET_KEY` (and optional `STRIPE_PORTAL_CONFIGURATION`). Pro granted by an administrator with no Stripe subscription shows its end date and no cancel button.

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
- `/?preview=account`: Free account page.
- `/?preview=pro-account`: Pro account page with cancel and keep-Pro flow.

## Verification

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
The tests use local mocks/PGlite, not hosted data. Live Stripe purchases are intentionally unavailable. Hosted migrations, entitlements, Google voices, and Gemini summaries must be checked separately after configuration.

The Pro branch also includes main commits `a8b484b` and `9918cad`: the updated SID logo and Back navigation, upright image preparation, and Vision-assisted photo geometry. Gemini remains the authoritative transcription.

Local verification of the combined version passed 71 unit/database tests, 9 browser tests across desktop/tablet/phone sizes, lint, typecheck, and a webpack production build. Providers and hosted Supabase were mocked; no production migrations, billing changes, push, or deployment were performed.
