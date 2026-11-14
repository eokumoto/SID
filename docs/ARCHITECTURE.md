# Architecture

One Next.js app on Vercel, one Supabase project, one deployment. The browser uses Supabase for auth and owner-scoped data operations; `/api/process` performs AI work and a separate `/api/history/import` route handles optional guest-history imports. These docs describe the target build. The repo currently contains a runnable frontend prototype and the initial Supabase schema. The current home page is photo-only: SID plus two large actions, Take picture and Upload file. It previews the selected image locally; no upload, OCR, AI, auth, history, paste-text input or reader controls are connected. Earlier text-input flows below are superseded by this photo-only UI direction.

## Layers

| Layer | Job | Talks to |
| --- | --- | --- |
| Presentation | Capture/paste, reader, original comparison, review notes, settings and history | Supabase through RLS/restricted RPCs; `/api/process` |
| API | Verify user, validate input ownership, atomically claim work/usage, run providers, conditionally save results | Supabase with server credentials; Gemini; optional Vision |
| AI/OCR | Gemini reads and rewrites; optional Vision provides a separate read | Called by the API only |
| Data | Documents, settings, usage and private photos | Browser with restricted permissions; server processing transaction |
| Auth | Anonymous access, Google or email/password upgrade and login | Supabase Auth |

Supabase has its own managed secrets. Among our application code, only `app/api/process` may read Gemini and Vision credentials. The service-role key is limited to that route and `app/api/history/import`, which needs both guest and destination identity verification to save guest scans into an existing account. RLS prevents cross-user browser access, but service-role operations need explicit owner and exact file-path validation.

## Data flow

```mermaid
flowchart LR
    B[Browser] -->|1 auth, 2 upload and queued row| S[(Supabase)]
    B -->|3 document id and bearer token| A[/api/process]
    A -->|4 verify, validate, claim and reserve usage| S
    A -->|5 read and rewrite| G[Gemini]
    A -->|5 optional second read| V[Vision]
    A -->|6 checks and conditional result update| S
    A -->|7 result or short error| B
    B -->|8 history, review RPC, removal and delete| S
```

1. Open Scan without a login screen. Silently reuse/create a private anonymous Supabase session unless an account is already signed in. Every scan has an owner from the start; anonymous authentication is an implementation detail, not a user login requirement.
2. Generate a UUID, shrink an image to about 1600 px/JPEG, upload to `scans/{user_id}/{document_id}.jpg`, then create a `queued` image row. Text rows instead hold immutable `input_text`, with no photo. Clean up failed uploads/inserts.
3. Call `POST /api/process` with `{ documentId }` and the current guest/account access token. Initial processing and Retry use the same route.
4. Verify the user, load only their row, validate the exact derived object key and input bounds, and atomically claim eligible work plus daily usage. Return ready results without reprocessing and reject duplicate active attempts.
5. Run Gemini and, for images when enabled, Vision in parallel. Vision failure falls back to Gemini with a visible warning. Pasted input itself is the check source; image rows retain OCR provenance.
6. Validate JSON, run deterministic checks and save only if the current attempt still owns the row. Normal failures become `failed`; hard-terminated work becomes eligible for recovery after 2 minutes from `processing_started_at`.
7. Show the reader with flags, correction notes, OCR warnings and the original available for checking. Photos are saved until explicit removal or scan deletion.
8. Reopen History directly under RLS. Review uses a restricted owner RPC. Removal and deletion handle partial failures. Processing workers never upsert results, recreate photos or overwrite newer attempts. The import route creates separately owned copies through its idempotent import flow.

The full lifecycle, response codes, quota rules and deadlines are in [API.md](API.md). The target schema, missing migrations and delete procedures are in [DATA_MODEL.md](DATA_MODEL.md).

## Screens

| Screen | Behavior |
| --- | --- |
| Optional account screen | Opened by "Save my history" or "Log in"; Google or email/password, with "Continue as guest". Cancel returns to the current scan. |
| Scan | Camera, screenshot upload or paste. Explain before upload that photos/text stay in History until deletion and ask users to avoid private documents. No "Keep photo" toggle in core. |
| Reader | Real text in OpenDyslexic; rewrite/source toggle; flag review and labeled correction notes; font size, spacing and background tint controls. Corrections do not silently edit the rewrite. |
| History / guest recent scans | Signed-in users get saved History; guests see "Recent scans on this browser" and an optional save-history action. Queued, processing, ready and failed states; processing expires after 2 minutes from the latest claim, not creation. Retry calls the API. Ready documents reopen without reprocessing. |
| Data controls | Remove an original photo, delete a scan, or "Delete all scans and settings." Explain that bulk deletion retains account/usage. Photo removal disables new review and failed-image Retry. |

Always show "Simplified by AI. Check the original for anything important." When an image original was removed, show "Original photo removed; OCR may contain errors" and do not label OCR as the original image. Existing correction notes remain readable.

## Guest use and accounts

Guest use is permanent core functionality, not a placeholder until login is built. Scan, Reader, flag review, Retry, guest recent scans and deletion accept valid anonymous sessions. Only durable account History and cross-device recovery require Google or email/password login. Show "Save my history" after a result and in guest recent scans; dismissing it must not interrupt reading.

- **New visitor:** show Scan immediately; create the anonymous session in the background before the first upload or row write. If guest-session creation fails, show a retryable connection error rather than requiring account signup.
- **Returning guest:** reuse the same session and show its recent scans. Explain that these remain accessible only while this browser keeps that session; they are not local-only files and losing access does not delete them.
- **Create an account:** upgrade the guest identity using the supported email/password upgrade or explicit Google identity linking so its user id and scans are preserved. Verify successful conversion to a non-anonymous identity before saying history is saved. For the hackathon, email confirmation is off; call this a deliberate test configuration.
- **Log in to an existing account:** offer "Save my guest scans to this account" selected by default, with a clear option to skip. Preserve the guest session credential securely for the import before switching auth; the selected OAuth/session implementation must support this across redirects without exposing tokens in URLs or logs. `/api/history/import` verifies both identities and copies eligible guest scans into the destination account. A provider identity-already-exists result leads to this login/import flow, not a failed signup with lost scans.
- **Pending work:** wait for guest processing to finish or expire before import. Do not claim completion while a scan is still processing. Imports preserve ready results/review notes, use new document ids and destination-owned photo paths, and never rerun AI. See [the import contract](API.md#guest-history-import).
- **Cancel or failure:** keep guest access intact if login is cancelled. If login succeeds but import fails, show account history plus a retryable "Guest scans not saved yet" notice; keep the import credential available only as long as needed and never claim the guest history is saved. Discard it after successful import, explicit skip or sign-out. Do not silently delete skipped guest scans.
- **Sign out:** clear account history/results and signed photo URLs from the UI and caches. Starting a new guest scan creates/reuses a separate anonymous session; it must never display the signed-out account's data.

An anonymous Supabase user still receives an authenticated token and owns private rows; "no sign-in required" describes the user experience, not public access to documents. Quotas still apply to guests. There is no automatic guest-data expiry in core; if retention cleanup is added later, document and implement its policy before advertising it.

## Add-ons

Only after core passes on the live URL, in order:

1. Read aloud with word highlighting using Web Speech API; use sentence highlighting where word boundaries are unavailable. Test desktop Chrome, Safari and a phone. Make correction-note behavior explicit.
2. Saved reader settings in `profiles.settings`.
3. Canvas overlay mode as an optional view; keep real reader text available.
4. A second font choice (Lexend or Atkinson Hyperlegible).
