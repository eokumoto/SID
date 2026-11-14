# SID

Photo-first reader UI built from [SID-UI-SPEC.md](docs/UI_SPEC.md) and the supplied desktop/mobile HTML wireframes. The current UI spec supersedes older plans for paste-text input, confirmation flags and a custom camera screen.

## Run

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). No credentials are needed to review the UI.

## Implemented

- One central Upload button using the native image picker. Desktop drag-and-drop and image pasting are supported; text pasting is not.
- Cream/navy palette, flat outlined controls and self-hosted OpenDyslexic/Lexend fonts.
- Processing, text/photo reader, settings, optional login, history, deletion and error layouts for desktop and mobile.
- Live font/size/spacing/background settings stored on this device; signed-in accounts also sync `profiles.settings` when Supabase is configured.
- Read aloud with word-boundary highlighting where supported, section highlighting otherwise. Browser/voice support varies.
- Zoom/pan in Photo view; the sample flyer also demonstrates a pinned rewritten overlay. Live Vision bounding-box overlays are not implemented.
- Optional Google OAuth and email/password login and signup, plus account history reads and deletion through Supabase RLS. Configure both public Supabase variables in `.env.local`, auth providers, and allowed app redirect URLs before using these integrations. Real auth/database behavior needs a configured project to verify.

## Preview screens

These routes use clearly labeled sample documents. They do not log in, write account data, send photos to AI, or persist sample history changes.

| URL | Screen |
| --- | --- |
| `/` | Home |
| `/?preview=processing` | Reading / Rewriting |
| `/?preview=reader` | Text reader |
| `/?preview=photo` | Photo overlay and zoom |
| `/?preview=settings` | Settings |
| `/?preview=login` | Login |
| `/?preview=history` | History with sample account |
| `/?preview=empty` | Empty history |
| `/?preview=delete` | Delete confirmation |
| `/?preview=error` | Too blurry |
| `/?preview=offline` | No connection |

Settings persist locally, including when reviewing samples. History samples reset on reload.

## Scanning setup

Uploads are stored privately in Supabase Storage, then processed by the server-only `/api/process` route. Gemini reads the image and creates the plain-language rewrite. Google Cloud Vision can optionally perform a second OCR read; when it is unavailable, a successful Gemini scan still completes.

1. Apply all Supabase migrations in order, including `20261114000000_scan_processing.sql` and `20261114010000_processing_claims.sql`. Deploy the new client and route together after the migrations; older clients that insert `status` are deliberately rejected by the restricted input permissions.
2. In `.env.local` and the deployment environment, set the two public Supabase values, `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`), and `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to the pinned `gemini-3.5-flash-lite`; confirm the configured model is available to your key before the live scan check. Update any existing Vercel override of `gemini-2.5-flash`, which Google now restricts to previous users; see [Google's deprecation notice](https://aistudio.google.com/docs/deprecations#gemini-2.5-flash-models). Redeploy after changing environment variables. `DAILY_LIMIT` defaults to 20 admitted attempts per user per UTC day, including attempts that fail.
3. Enable anonymous sign-ins in Supabase Auth so a visitor can scan before logging in.
4. To enable the second OCR pass, enable Cloud Vision API, give a service account Vision access, set `GOOGLE_CLOUD_CREDENTIALS` to its JSON credentials (or a base64-encoded copy), and set `VISION_ENABLED=true`.

Images are limited to 5 MiB and JPEG, PNG, or WebP. Provider credentials stay on the server and are never sent to the browser.

Processing claims and daily usage are reserved in one database transaction. Active duplicates observe the existing attempt; expired attempts can be retried after two minutes. Completion and failure writes match the attempt id, so old workers cannot overwrite a Retry or recreate a deleted scan. Gemini JSON is validated and retried once on malformed output; optional Vision runs in parallel with its own timeout. Ready rows reopen without provider calls.

Deterministic checks compare protected values, occurrence counts and candidate names and store advisory flags without introducing a confirmation workflow. These conservative checks can flag harmless formatting changes and miss changed relationships, omitted prose or negation; they are not a proof of accuracy. Readers retain the original photo and show a warning when the second read was unavailable.

Local checks use mocked providers and an embedded PostgreSQL engine with minimal Supabase schemas. They do not validate hosted Supabase settings, provider access or image quality. To finish the live milestone, apply the migrations, configure credentials, enable anonymous sign-in, deploy, then upload a public-text photo as a guest and an account. Compare the rewrite with the photo, reopen account history, exercise Retry and confirm the photo/text survive a reload. Guest-to-existing-account history imports remain separate work.

When a scan fails, the reader distinguishes Gemini quota/rate limits, rejected keys/access, unavailable models, rejected requests, blocked/incomplete replies, invalid JSON and failed photo downloads. Provider failures retain `error = 'ai_failed'` in the database; the processing response also supplies a fixed `reason` code. Vercel runtime logs contain `scan_processing_failed` with the document id, error and optional reason, never the photo, document text, key or raw provider response. A quota message can indicate a rate or quota limit; inspect that project's Google AI Studio usage before changing billing or the configured model.

Login is optional; unconfigured auth reports **Not connected**. Email uses a two-step password flow: enter an email, then automatically continue to Log in for an existing email or Create account for a new email. New accounts provide Name and enter/confirm a password (at least 8 characters). The automatic check uses a private server-side Supabase RPC and sends no email. New scans are stored under the active guest or account identity. Preserving guest scans across an OAuth/email-confirmation round trip or importing them into an existing account still needs the guest-history integration; do not assume those scans transfer after login. Account history currently loads the latest 100 rows, with five-minute photo URLs refreshed when history reloads. Pagination and automatic signed-URL renewal remain backend/integration work.

The initial Supabase migration remains unchanged. [DATA_MODEL.md](docs/DATA_MODEL.md) and [API.md](docs/API.md) contain earlier backend planning, including some superseded input/review assumptions; reconcile them with the current UI spec before implementing those features. Do not build their older confirmation-flag or paste-text flows into this UI.

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

If this execution environment blocks Turbopack's local compiler port, use `npm run build -- --webpack`.

Keep real credentials in untracked `.env.local` or deployment environment variables. AI/service-role credentials must never enter the browser. This UI only reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Password authentication setup

Enable Email and allow new-user signups in the hosted Supabase project. Existing accounts use `signInWithPassword`; Create account uses `signUp`. If Confirm email is enabled, a signup without a session shows Check email and requires confirmation before login; with it disabled, a successful signup can log in immediately. The local `supabase/config.toml` does not change the hosted project. Supabase may return a deliberately obfuscated result for duplicate signups; SID does not assume it can discover every existing account.

Forgot password sends a reset link through Supabase. A valid `PASSWORD_RECOVERY` event opens Set password and saves through `updateUser`. Signup stores the trimmed Name as `auth.users.raw_user_meta_data.name`; the avatar uses its initial. Passwords stay in component memory, are cleared on step changes/unmount, and are never logged or stored by SID. Google login remains available. Configure the live/local root URLs in Supabase's redirect allowlist. Confirmation/reset emails still require working email delivery and are subject to the project's rate limits.

Password auth replaces the original magic-link login requirement in the supplied UI spec. After code changes, push/deploy to update the live website; changing only Vercel variables does not deploy new UI code.

## Automatic email lookup setup

1. Apply [20261113010000_auth_email_lookup.sql](supabase/migrations/20261113010000_auth_email_lookup.sql) to the same hosted Supabase project, using the SQL Editor once or the normal migration workflow. It creates a private rate-limit table and service-role-only lookup RPC. It does not delete users, change email confirmation, or send email.
2. Add `SUPABASE_SECRET_KEY` in untracked `.env.local` and Vercel Production using a **Supabase Secret key**, never the publishable key. A legacy server-only `SUPABASE_SERVICE_ROLE_KEY` is also supported. The route reads this key only on the server; do not use a `NEXT_PUBLIC_` prefix.
3. Restart local dev; push/deploy the code and redeploy Vercel after adding the variable.

`POST /api/auth/email-status` accepts only `{email}`, validates the input and origin, and returns only `{exists}`. Database-backed throttling admits 30 checks per hashed client IP per five-minute window across server instances. Old limiter rows are removed during checks. On Vercel, the IP comes only from its platform-provided header; non-Vercel hosts share a local bucket until a trusted proxy integration is designed. The route sends no emails and does not use signup failures to guess membership.

This UX intentionally discloses whether an email has an Auth account in this Supabase project. It does not disclose names or user records. Lookup does not authorize access to account data; password/Google authentication and RLS still apply. Unknown/missing server config or an unapplied migration fails closed with an unavailable message, never a guessed signup/login result. Preview screens keep their sample-only manual paths and never query real accounts.

Supabase Auth users and email quotas are shared by all apps using the same Supabase project. The built-in email sender currently allows two emails/hour per project and team addresses only. Confirmation, reset, and earlier magic-link requests can consume that quota; deleting users does not reset a project email quota. With Confirm email disabled, password signup does not need a confirmation email, which can explain why another project permitted many signups. For public email delivery, configure custom SMTP and review Authentication → Rate Limits. Confirm email/SMTP/rate-limit dashboard settings are not changed by this code or migration. Diagnose specific failures in Authentication logs; never share access tokens or private keys in screenshots.
