# SID

Photo-first reader UI built from [SID-UI-SPEC.md](docs/UI_SPEC.md) and the supplied desktop/mobile HTML wireframes. The current UI spec supersedes older plans for paste-text input, confirmation flags, password login and a custom camera screen.

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
- Optional Google OAuth and email magic-link actions, plus account history reads and deletion through Supabase RLS. Configure both public Supabase variables in `.env.local`, auth providers, and allowed app redirect URLs before using these integrations. Real auth/database behavior needs a configured project to verify.

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

## Backend boundary

This task implements the UI. Uploaded images stay in page memory and are released on replacement/unmount. An upload currently shows the processing layout followed by **Not connected** because there is no OCR/rewriting endpoint. It never shows sample output as the result of a user's photo. Selecting an image is limited to 10 MiB in this UI; the eventual backend/bucket must enforce their own limits.

Login is optional; unconfigured auth reports **Not connected**. Email uses a magic link, not a password. Auth is wired on the client, but preserving an in-memory guest scan across an OAuth/magic-link round trip and saving a newly processed scan still need the processing/storage flow. The UI must not claim those scans were saved until that backend succeeds. Account history currently loads the latest 100 rows, with five-minute photo URLs refreshed when history reloads. Pagination and automatic signed-URL renewal remain backend/integration work.

The initial Supabase migration remains unchanged. [DATA_MODEL.md](docs/DATA_MODEL.md) and [API.md](docs/API.md) contain earlier backend planning, including some superseded input/review assumptions; reconcile them with the current UI spec before implementing those features. Do not build their older confirmation-flag or paste-text flows into this UI.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
```

If this execution environment blocks Turbopack's local compiler port, use `npm run build -- --webpack`.

Keep real credentials in untracked `.env.local` or deployment environment variables. AI/service-role credentials must never enter the browser. This UI only reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
