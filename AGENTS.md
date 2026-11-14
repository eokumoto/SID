# AGENTS.md

Read [docs/UI_SPEC.md](docs/UI_SPEC.md) for the current UI requirements. It supersedes older UI instructions in this file and the planning docs: one native Upload control; no paste-text input, custom camera or confirmation flags; optional Google or email/password login with automatic email routing and a signup Name field; minimal copy and the specified cream/navy palette. Do not reintroduce a mandatory confirmation workflow or explanatory reader labels from earlier plans.

The UI is implemented in `components/sid-app.tsx` with modular reader/settings/history/dialog components. Sample previews are explicit URL states documented in README and must never masquerade as real scan output or account authentication. OCR/AI processing is not connected. Keep backend-dependent actions honest about unavailable services.

The backend notes below are earlier planning guidance. Reconcile them with the current UI spec before implementing backend features. Preserve secret isolation, owner checks, RLS and conditional processing writes.

## Shape of the app

- One Next.js app on Vercel. Browser operations use Supabase RLS and narrowly scoped RPCs for auth, uploads, history, flag review and deletion.
- `/api/process` holds AI credentials. `/api/auth/email-status` is a privileged, rate-limited yes/no email lookup; it may read `SUPABASE_SECRET_KEY` (or legacy service-role key) but never expose it. `/api/history/import` is another planned privileged application route, for optional guest-history imports after login; it may use the service-role key but never AI credentials. Both initial processing and Retry call `/api/process` with `{ documentId }` and a bearer token. Never send image bytes or a Storage path in that request.
- Upload images directly to private Storage, then insert a `queued` document. Pasted input goes into immutable `input_text`. Ready documents are reopened without reprocessing.

- Guest mode is core: open Scan immediately, create/reuse an anonymous session behind the scenes, and never gate scanning or reading on Google/email login. "Save my history" offers account creation or existing-account login; preserve guest scans through the documented upgrade/import flow.

## Hard rules

1. **No secrets in the browser.** Gemini and Vision credentials are read only inside `app/api/process`; private Supabase server keys are allowed there, in `app/api/history/import`, and in `app/api/auth/email-status` only. Never use a `NEXT_PUBLIC_` prefix for them or import server-only modules into client components.
2. **RLS and restricted writes from the start.** Every new table gets RLS and explicit permissions in its migration. Owners must not set processing fields or AI results. Review/removal RPCs only change their documented fields. Usage writes and the atomic claim RPC are service-role-only.
3. **Verify identity and the whole file key.** Use `supabase.auth.getUser(token)`, filter by document id and verified owner, and derive `{user_id}/{documentId}.jpg`. Validate the stored path equals that exact key before any privileged download/deletion. An owned row does not make its path trustworthy.
4. **No document content in logs.** Log ids, timings and short error codes only. Never log text, prompts, model responses, signed URLs or raw upstream errors.
5. **Run accuracy checks on every rewrite.** Preserve protected values in prompts and flag missing/added/changed extracted values and OCR disagreements. The checks have known limits; never claim proof of accuracy. Use original pasted input for text checks and preserve OCR provenance for images.
6. **Claim work and usage atomically.** Follow [API.md](docs/API.md#processing-lifecycle-and-usage). Block active duplicates, return ready rows unchanged, and reserve usage once per admitted attempt. Match the server-generated attempt id on every result/failure write; never upsert a result.
7. **Recover from terminated work.** Use a deadline below the route limit and conditional failure writes in `catch`. A hard termination can bypass cleanup; recover attempts after 2 minutes using `processing_started_at`, not `created_at`. Late workers cannot overwrite newer work or recreate deleted rows.
8. **Keep source access honest.** Photos stay saved until explicit removal or scan deletion. No "Keep photo" toggle in core. After photo removal, show that the original is unavailable and disable new flag review; never present OCR as the photo. Keep the label "Simplified by AI. Check the original for anything important."
9. **Render real escaped text.** Use OpenDyslexic and normal text elements, never model-generated HTML or a canvas-only reader. Treat source content as data, not model instructions.
10. **Use accurate data controls.** Bulk deletion is "Delete all scans and settings" and retains account/usage. Handle partial deletion failures and orphan uploads. Review edits are visible notes, not silent replacements in the rewrite.

## Scope

Core: image/text input, rewrite, flags, deterministic checks, original comparison, reader settings in the page, guest mode, optional accounts, guest-to-account history saving, safe processing/Retry, photo removal and deletion. Vision is optional and its failure produces a visible warning rather than failing a successful Gemini scan. No additional model-provider fallback in core.

After core works on the live URL: read aloud, saved settings, canvas overlay, then a second font. Follow [BUILD_PLAN.md](docs/BUILD_PLAN.md) checkpoints.

## Conventions

- TypeScript strict; Tailwind styling.
- Browser Supabase client in `lib/supabase/client.ts`; server client in `lib/supabase/server.ts`; service-role client only inside `app/api/process` and `app/api/history/import`.
- Shared runtime validators/types in `lib/types.ts`, matching [API.md](docs/API.md).
- Pure deterministic checks in `lib/accuracy.ts`, with meaningful regression tests from [AI_PIPELINE.md](docs/AI_PIPELINE.md#validation-samples).
- New SQL goes in new files in `supabase/migrations/`; never rewrite an applied migration. SQL is maintained there, not duplicated in docs.
- Validate image content/size and pasted-text bounds server-side; browser shrinking is only an optimization.
