# SID

Snap a photo or screenshot of any hard-to-read text (a menu, a club flyer, a class handout, a web page, a long message), or paste text in, and get it back in a dyslexia-friendly reader view: plain-language rewrite in OpenDyslexic, with flags for detected uncertainty that you can check against the original.

**What makes it more than asking a chatbot**

1. **Plain-language rewrite with confirm flags.** Short sentences prompted to preserve names, numbers, dates and prices; AI can still make mistakes. Detected blurry words, odd abbreviations and unreadable numbers become flags you can review.
2. **Accuracy check in code.** Code checks for common changes to extracted numbers, dates, times, prices, codes, links and candidate names, and flags detected differences. It does not prove the rewrite or OCR is accurate.
3. **Try without signing in; save history with an account.** Open Scan and use the reader immediately as a guest. Choose "Save my history" to sign up or log in. New accounts keep the guest scans; existing-account login offers to save those scans into that account too.
4. **Saved originals with delete controls.** Check flags against the photo or pasted input. Photos stay saved until you remove them or delete the scan; bulk deletion removes scans and settings while keeping your account and daily usage counters.
5. **Read aloud with word highlighting** *(add-on, only if checkpoints are on track).*

> Simplified by AI. Check the original for anything important.

## Run the starter

The current implementation is a minimal photo-only UI: two large actions, **Take picture** and **Upload file**, followed by a local image preview. The camera action requests the rear camera on supported phones; other devices may show a file picker. JPG, PNG and WebP images up to 5 MB are supported. It runs without keys or sign-in. There is no paste-text option. Nothing is uploaded or saved; OCR, AI rewriting, the result reader, auth and history are not connected yet. The product plans below still contain earlier text-input proposals; the current UI direction is photo-only.

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Use `npm run lint`, `npm run typecheck` and `npm run build` to check the starter. The remaining sections describe the planned product.

## Guest use and saved history

No email, password or Google sign-in is required to scan, read, review flags or retry. The app creates a private anonymous Supabase session behind the scenes so guest scans still have an owner and RLS protection. Show Scan first, with an optional "Save my history" button after a result; never block the reader with a login prompt.

Guest scans can be reopened as "Recent scans on this browser" while that browser retains its guest session. They are not recoverable through an account yet: clearing browser data, switching browsers/devices or losing the session can make them inaccessible. Signing up or logging in saves history for later access across devices. Losing a guest session does not itself delete server-stored data; do not promise automatic guest deletion.

See [the account flow](docs/ARCHITECTURE.md#guest-use-and-accounts) for guest upgrades, existing-account imports and cancellation behavior.

## Stack

| Part | Pick |
| --- | --- |
| App | Next.js (App Router, TypeScript), Tailwind CSS |
| Hosting | Vercel |
| Auth, database, storage | Supabase (Auth, Postgres with RLS, private Storage bucket) |
| Read and rewrite | Gemini API (free tier, Google AI Studio) |
| Optional second read | Google Cloud Vision, document text detection; visible warning when unavailable |
| Reader font | OpenDyslexic, self-hosted |
| Read aloud (add-on) | Browser Web Speech API |

## Docs

| File | What's in it |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Rules for AI coding tools working in this repo |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, data flow, what talks to what |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Tables, Storage, RLS policies; schema in [supabase/migrations/](supabase/migrations/) |
| [docs/API.md](docs/API.md) | `POST /api/process` contract and the AI JSON shape |
| [docs/AI_PIPELINE.md](docs/AI_PIPELINE.md) | Prompt rules, Vision flags, the accuracy check |
| [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) | Weekend checkpoints, task split, add-ons |
| [docs/DEMO_AND_PITCH.md](docs/DEMO_AND_PITCH.md) | Demo script, pitch outline, user testing |

## Setup

> The UI starter runs with the commands above and needs no credentials. The steps below are for connecting the planned backend. The target lifecycle, guest-history import and permissions require the follow-up migrations in [DATA_MODEL.md](docs/DATA_MODEL.md#required-follow-up-migrations).

1. Install the existing Next.js/TypeScript/Tailwind starter with `npm install`. The root `.gitignore` excludes local secret files, dependencies and build output.
2. Copy `.env.example` to `.env.local` and fill in the backend values below when implementing those integrations. Never put real credentials in the template.
3. Implement the [required follow-up migrations](docs/DATA_MODEL.md#required-follow-up-migrations), link the Supabase project and apply the schema:
   ```sh
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   Or connect the repo with Supabase's GitHub integration (working directory `.`) so migrations in `supabase/migrations/` are applied from GitHub.
4. In the Supabase dashboard (Authentication → Providers / Sign In), turn on **Google**, **Email** with email confirmation **off**, **Anonymous** sign-in, and **manual identity linking** (so an anonymous account can link Google later). `supabase/config.toml` sets the same for local dev only.
5. Configure Google OAuth client credentials, the Supabase callback, and allowed local/Vercel app redirect URLs. For local Google auth, provide `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` to the local Supabase environment; these are separate from the app env vars below. Test a new-account guest upgrade without changing the user id, and the explicit guest-history import into an existing account separately. Guest scanning must work without configuring or opening a Google/email login flow.
6. Once the backend is implemented, run `npm run dev`. Verify the lifecycle, ownership and deletion checks before sharing the live URL.

### Environment variables

| Name | Where it's used | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server | No |
| `SUPABASE_SERVICE_ROLE_KEY` | `/api/process` and `/api/history/import` only | **Yes** |
| `GEMINI_API_KEY` | `/api/process` only | **Yes** |
| `GOOGLE_CLOUD_CREDENTIALS` | `/api/process` only; Vision service-account JSON, explicitly parsed by the app when enabled | **Yes** |
| `GEMINI_MODEL` | `/api/process`; pin a verified image/JSON-capable model id | No |
| `VISION_ENABLED` | `/api/process`; `false` until credentials/setup are ready | No |
| `DAILY_LIMIT` | `/api/process`; positive integer attempts/account/UTC day, required before launch | No |

App secrets live in Vercel env vars or untracked `.env.local`; local Supabase OAuth secrets live in its untracked environment. Never commit credentials or prefix a secret with `NEXT_PUBLIC_`. Fail startup clearly when required configuration is missing; Vision credentials are optional when `VISION_ENABLED=false`.

## Privacy

- Test with everyday public text, not private documents. Free AI tiers may use inputs to improve their models.
- Guest scans are stored privately under a browser guest session; account history is stored under the signed-in account. Photos, pasted input, OCR and rewrites remain server-stored until deletion, even if a guest loses access to their session. Explain this before upload. Removing a photo retains its OCR/rewrite but disables new flag review; checking then requires a new scan.
- "Delete all scans and settings" removes app documents, uploaded files and reader settings. It retains your login account and daily usage counters. It is not account deletion or a promise to erase provider-side data.
- Logs hold ids, timings and error codes only, never document text.
