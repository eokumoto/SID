# Build plan

Fri 5 PM to Sun 12 PM, Pacific. Hard deadlines: **live link by Sat 8 PM**, **submission by Sun 12 PM**.

The repo has a minimal UI prototype, docs and an initial schema. Backend integration is not implemented. The target lifecycle and permissions require new migrations; see [DATA_MODEL.md](DATA_MODEL.md#required-follow-up-migrations).

Build the thinnest working path first (photo in, readable text out, live on Vercel), then the rewrite and flags, then optional accounts and saved history, so there is always something demoable. Add-ons only if checkpoints land on time.

## Team split (3 or 4 people)

| Area | Owns |
| --- | --- |
| Frontend | Scan, Reader, History screens, OpenDyslexic, reader settings, add-ons |
| API and AI | `/api/process`, Gemini prompt, Vision, accuracy check |
| Supabase | Tables, RLS, Storage, auth providers, RLS tests |
| Testing and pitch (from Sat morning) | Recruiting testers, feedback, demo flyer, pitch, backup video |

## Fri 6 PM to midnight: skeleton and OCR

- [ ] Scaffold Next.js with Tailwind in this repo, add `.gitignore` and a credential-free `.env.example`, deploy to Vercel
- [ ] Create/link Supabase, implement the required lifecycle/permission migrations, then `npx supabase db push`; enable anonymous sign-in and manual identity linking
- [ ] Implement exact image-path validation, server input limits, atomic claim/usage reservation and attempt-scoped result writes; test duplicates before sharing the URL
- [ ] Configure Gemini credentials, pin a verified model id, set `DAILY_LIMIT`, and keep `VISION_ENABLED=false` until tested; configure provider quotas and budget alerts
- [ ] First Gemini prompt that returns the text it read as JSON
- [ ] Start on Scan with no login requirement; silently create/reuse a guest session before writes. Take or pick a photo, shrink it, upload to Storage, create the row, call `/api/process` with the document id, show the text in OpenDyslexic

**Checkpoint 1 (midnight):** on the live Vercel URL, a phone photo of a page comes back as readable OpenDyslexic text.

## Sat 8 AM to 1 PM: rewrite and flags

- [ ] Rewrite prompt and JSON shape ([AI_PIPELINE.md](AI_PIPELINE.md)); test on the 5 samples
- [ ] Accuracy check with missing/added/changed values and occurrence counts, candidate names, and Gemini uncertainty flags; run regression cases in [AI_PIPELINE.md](AI_PIPELINE.md#validation-samples)
- [ ] Optionally enable Vision; flag low-confidence words and OCR disagreements, retain provenance and show a warning on fallback. Drop setup after an hour if blocked
- [ ] Reader: real text, original toggle, review RPC and labeled correction notes; paste option with immutable input. Explain notes do not replace rewrite text
- [ ] Reader settings in the page (font size, spacing, background tint), not saved yet

**Checkpoint 2 (1 PM):** a sample flyer produces a rewrite with reviewable flags; a person checks names, dates, numbers and meaning against the original. Accuracy regression cases pass, including documented cases the check cannot detect.

## Sat 1 PM to 6 PM: login, history, photos, delete

- [ ] Keep Scan, Reader, review and Retry open to guest sessions. Add optional "Save my history" signup/login with Google or email/password (email confirmation off)
- [ ] Preserve new-account guest upgrades; implement the dual-identity history import route and ledger for existing-account login, including copy retries, cleanup and cancellation
- [ ] Distinguish guest "Recent scans on this browser" from account History; test session loss, returning guests and clearing account data from UI on sign-out
- [ ] RLS test with two accounts ([DATA_MODEL.md](DATA_MODEL.md#rls-test-checkpoint-3))
- [ ] History: queued/processing/ready/failed, stale attempts using the latest processing timestamp, API Retry and ready-row reuse
- [ ] Save photos until explicit removal. Implement removal, disabled review after removal, delete scan and "Delete all scans and settings" with partial-failure handling and orphan-file cleanup

**Checkpoint 3 (6 PM):** a visitor can scan without logging in, then sign up or log in to save the scans; cancellation preserves guest access and interrupted imports can resume. Two accounts are isolated, including against forged image paths and direct writes. Duplicate requests reserve usage once; expired workers cannot overwrite retries. Delete removes row/photo, partial failures can be retried, and photo removal clearly disables new review.

## Sat 6 PM to 8 PM: ship and start testing

- [ ] Submit the live link before 8 PM
- [ ] Short feedback prompt after each scan; log events (scan done, flag confirmed, setting changed)
- [ ] Start testing with real students ([DEMO_AND_PITCH.md](DEMO_AND_PITCH.md#user-testing))

**Checkpoint 4 (8 PM):** live link submitted and at least 3 real people have tried it.

## Sat 8 PM to Sun 9 AM: fix, then add-ons

- [ ] Fix the top 3 problems from testing
- [ ] Add-ons, only if Checkpoints 1 to 4 landed on time, in order: read aloud with word highlighting, saved reader settings, canvas overlay mode, a second dyslexia font
- [ ] Keep testing; aim for 8 to 10 real users with quotes and before-and-after timing

## Sun 9 AM to 12 PM: freeze, pitch, submit

- [ ] Feature freeze at 10 AM; only bug fixes after
- [ ] Seed a demo account with 2 or 3 sample scans; run the flyer demo 5 times and confirm the flag appears each time; record a backup demo video
- [ ] Pitch ([DEMO_AND_PITCH.md](DEMO_AND_PITCH.md))
- [ ] Submit by 11:30 AM

**Checkpoint 5 (11:30 AM):** submitted, demo rehearsed twice on the laptop used for judging.

## Risks

| Risk | Mitigation |
| --- | --- |
| AI changes a date, price or name | Prompt, deterministic checks with known limits, flags and original comparison until explicit removal; keep the "Simplified by AI" label |
| Accuracy check misses errors or flags too much | Typed whole-token checks, added/missing values and regression cases; manually review meaning and disclose limits rather than weakening checks to force zero flags |
| Demo flag doesn't appear | Team-made flyer with a smudged room code; run it 5 times; seeded account |
| Users scan private documents | Public-text testing, retention notice before upload, explicit photo removal and bulk scan/settings deletion |
| Login blocks testers | Guest scanning/reading from first visit, optional signup/login to save history, cancellation returns to the scan |
| Poor OCR on phone photos | Shrink first, photo tips, uncertainty flags, visible correction notes or a new scan/paste with corrected input |
| Vision setup stalls | Drop it after an hour; drop "two independent reads" from the pitch |
| Upload too big or route too slow | Storage upload, server/bucket limits, internal 50-second deadline, 60-second route limit, 2-minute stale recovery and attempt-scoped Retry |
| RLS wrong | Policies from the start; `usage` has no write policy; two-account test |
| Key leak or runaway cost | Server-only secrets, atomic per-account daily attempt limit, provider quotas, signup abuse controls and budget alerts; anonymous accounts mean the per-account limit is not a global cap |
| Scope creep | Checkpoints; add-ons only if on track |
| Too few testers | Live link early; Disability Resource Center and clubs; log events |
| Seen as a ChatGPT wrapper | Lead with the accuracy check and confirm flags |
| Wifi or rate limit during demo | Seeded account, backup video, hotspot |
