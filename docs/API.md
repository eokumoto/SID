# API

`POST /api/process` holds the AI credentials. It and `POST /api/history/import` may use the service-role key; import is the only additional privileged application route. Auth, uploads, history, flag review and deletion go from the browser to Supabase under RLS. Processing and Retry always call `/api/process`; only the optional guest-history handoff calls the import route.

This is the target contract. The UI prototype does not call this route yet, and the initial migration does not implement the processing lifecycle or restricted browser writes. Apply the follow-up migrations in [DATA_MODEL.md](DATA_MODEL.md#required-follow-up-migrations) before implementing this contract.

## Guest access

Processing accepts both anonymous guest tokens and non-anonymous account tokens. Missing a Google/email identity is not an authorization error. The browser creates/reuses the guest session silently; there is no login screen before scanning, reading, review or Retry. Invalid or missing tokens still return 401 and must not expose public document access. Guest-to-account conversion and imports follow [the account flow](ARCHITECTURE.md#guest-use-and-accounts).

## `POST /api/process`

### Request

```http
POST /api/process
Authorization: Bearer <supabase access token>
Content-Type: application/json

{ "documentId": "6f1c4f00-0000-4000-8000-000000000001" }
```

Validate `documentId` as a UUID. Reject extra input fields. Never accept a user id, Storage path, model output or image bytes in this request.

Before calling, the browser generates a document UUID and either uploads a JPEG to the private `scans` bucket at `{user_id}/{documentId}.jpg`, or collects pasted text. It then inserts a `queued` document with exactly one input: `input_kind = 'image'` and the expected `image_path`, or `input_kind = 'text'` and immutable `input_text`. Clean up the uploaded file if row creation fails; bulk deletion also lists the owner's folder to find orphan uploads.

Retry sends the same `documentId`. Inputs do not change on Retry; corrected or replacement input creates a new document.

### Ownership and input validation

1. Verify the bearer token with `supabase.auth.getUser(token)` and use that returned user id for every operation.
2. Load the row filtered by **both** `id` and `user_id`. Return 404 for a missing or foreign document.
3. A `ready` row returns as stored before checking whether its original is still available. For eligible new work, reject an image with an explicitly removed original as 409 `original_unavailable`, with no usage reservation; the user must make a new scan.
4. For images with a retained original, derive the only allowed object key from the verified user id and document id. Require `image_path` to equal that key exactly. Never download or delete an arbitrary path stored in a row, even when the row belongs to the caller. Service-role operations bypass RLS.
5. Check input kind, nonempty text, JPEG content and size server-side before sending data to providers. Target limits: 20,000 text characters and 5 MiB per image; enforce the image limit and JPEG MIME allowlist in the bucket too. Browser shrinking to about 1600 px is an optimization, not validation.

## Processing lifecycle and usage

Use one service-role-only database transaction/RPC to claim work and reserve usage. It locks the owned document, checks its current state, and checks/increments the UTC daily count only when starting a new attempt. Do not separately call `bump_usage` and then claim a row: concurrent requests must not start duplicate work or reserve duplicate usage.

| State when called | Action |
| --- | --- |
| `ready` | Return the stored row, 200; no provider calls, usage charge or flag reset |
| `processing`, started less than 2 minutes ago | Return 409 `already_processing`; browser polls the owned row |
| `processing`, started at least 2 minutes ago | Treat the previous attempt as expired; atomically claim a new attempt if quota allows |
| `queued` or `failed` | Atomically claim a new attempt if quota allows |
| Quota exhausted for eligible work | Return 429 `daily_limit`; preserve `queued`/`failed`; an expired attempt becomes `failed` with `timeout` |

A claim sets `status = 'processing'`, `processing_started_at = now()`, a new server-generated `attempt_id`, and `error = null`. Each admitted attempt counts once, including attempts that later fail. An internal JSON repair retry belongs to the same attempt and is not charged again. A manual Retry after failure counts as a new attempt. Ready reads and duplicate requests do not count. The initial `bump_usage` function will be superseded by this transaction.

Set an internal deadline below the 60-second route limit (target 50 seconds), cancel provider calls at the deadline, and conditionally mark the attempt failed. On a normal error, do the same in `catch`. Hard termination can bypass `catch`: History uses `processing_started_at`, not `created_at`, to display expired work as timed out and offer Retry. It does not pretend a database update occurred. The next route call performs recovery atomically.

All completion/failure writes must match document id, owner, `status = 'processing'` and the current `attempt_id`. An expired worker must not overwrite a newer attempt. Update existing rows only; never upsert a result or recreate files. A deleted document stays deleted.

The daily limit is a per-account guard, not a global spending cap. Anonymous users can create new accounts. Configure the deployment's chosen `DAILY_LIMIT`, provider quotas, signup abuse controls and budget alerts before public testing; no claim of a global cost cap.

## Pipeline

1. After a successful claim, download only the validated image key, or use the immutable pasted `input_text`.
2. Call Gemini for the read/rewrite. For images, also call Vision when enabled, in parallel with an independent timeout. Vision failure is a warning and does **not** fail a successful Gemini result. No Groq or other provider fallback in core.
3. Validate JSON structure, field types and bounds (target: 80,000 characters for `plain_text`, 20,000 for source text, at most 200 entries in each model array, and 1,000 characters per flag field or candidate term). Reject oversized provider output instead of silently truncating document content. Retry invalid Gemini JSON once within the attempt deadline; otherwise fail with `bad_ai_json`.
4. Use pasted `input_text` as the authoritative text for pasted input, regardless of the model's echoed text. For images, retain Gemini's read separately; use Vision's full text for the accuracy check when usable, otherwise Gemini's read. Store `ocr_source` and show a warning whenever a second read was unavailable. See [AI_PIPELINE.md](AI_PIPELINE.md).
5. Run the deterministic accuracy check, merge flags, generate stable flag UUIDs and derive a short History title from source text (first nonempty line, at most 80 characters). The title is not an additional model field.
6. Conditionally save the result with `status = 'ready'`, `error = null` and warnings. Retain the original photo until the user explicitly removes it or deletes the scan. Return the saved row only if this attempt still owns the claim; otherwise return 404 if deleted, or 409 `attempt_superseded`.

```ts
// app/api/process/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;
```

## Responses

Error bodies have the shape `{ "error": "short_code" }` and contain no input text or upstream response bodies.

| Status | Code/body | Effect |
| --- | --- | --- |
| 200 | Saved `documents` row | Newly completed or already ready |
| 400 | `bad_request`, `invalid_input` | Reject request/input; if a claimed input proves invalid, mark that attempt failed |
| 401 | `unauthorized` | No mutation |
| 404 | `not_found` | Missing, foreign or deleted row; no recreation |
| 409 | `already_processing`, `attempt_superseded`, `original_unavailable` | No duplicate work, stale write or Retry without its original |
| 429 | `daily_limit` | No new attempt or usage charge |
| 502 | `ai_failed`, `bad_ai_json`, `storage_failed` | Claimed attempt marked failed if still current |
| 504 | `timeout` | Claimed attempt marked failed if still current |
| 500 | `unknown` | Best-effort conditional failure write; stale recovery handles termination/database outages |

Stored `documents.error` uses `invalid_input`, `ai_failed`, `bad_ai_json`, `storage_failed`, `timeout` or `unknown`. Vision unavailability is a warning, never `ocr_failed`.

## Gemini output shape

Ask for JSON with a response schema and validate the parsed result at runtime. Treat source documents as untrusted content, never as instructions. Render output as escaped text, not HTML.

```ts
export type GeminiResult = {
  source_text: string;
  plain_text: string;
  flags: GeminiFlag[];
  unsure_words: string[];
  key_terms: string[]; // model-supplied candidate names; not an exhaustive inventory
};

export type GeminiFlag = {
  original: string;
  reason: string;
  question: string;
};
```

## Stored flag shape and corrections

```ts
export type Flag = {
  id: string;
  source: "gemini" | "unsure" | "vision" | "accuracy";
  original: string; // source excerpt; empty for an addition with no source counterpart
  reason: string;
  question: string;
  status: "pending" | "confirmed" | "edited";
  edited_value?: string; // user's correction, displayed next to this flag
};
```

Confirming a flag records that the user checked it; it is not a machine verification. Editing saves `status = 'edited'` and `edited_value` and shows a labeled correction beside the flag. It does **not** automatically replace words in `plain_text` or alter source text: repeated words and OCR disagreements make global replacement unsafe. The reader must say that corrections are notes and the rewrite is unchanged. Read aloud, if built, must expose this limitation too.

Browser writes go through an owner-scoped review RPC that only changes a known flag's review fields; provider output, flag provenance and processing fields stay server-controlled. Reject empty corrections and unknown flag ids. Confirm/edit requires an available original photo or pasted input. After explicit photo removal, retain existing review notes but disable new confirmations and edits until the user makes a new scan.

## Guest history import

`POST /api/history/import` supports saving current guest scans after login to an **existing** account. New-account upgrades that preserve the user id need no import. This is an explicit exception to keeping all non-AI browser operations under RLS: the browser must never receive permission to reassign document owners or copy another owner's private files directly.

- `Authorization: Bearer <destination account access token>` plus a JSON body `{ "guestAccessToken": "..." }` over HTTPS. Never put either token in URLs, analytics or logs. The destination token must verify as a non-anonymous account; the source token must independently verify as an anonymous user. Derive both user ids from verified tokens, never client-supplied ids. Reject identical owners, registered source accounts, invalid tokens and unsupported extra fields. Do not offer arbitrary account merging.
- The user explicitly opts into saving guest scans during login. The route imports only documents owned by the verified guest, in bounded batches. Return 409 `guest_processing` if any source work is active; queued work must be completed or discarded first, and expired work normalized to failed without an AI call before import. Stop guest uploads/processing in the initiating UI during the handoff. If another tab creates more work, report it as remaining rather than claiming everything was imported.
- Copy each source into a new destination-owned document, preserving terminal status, source text, OCR provenance, rewrite and review notes. Generate new ids/paths and validate exact source/destination photo keys. A missing photo not previously marked removed is a partial import failure, not a silent successful copy. Preserve explicit removal metadata. Clear processing claim fields; no provider calls and no new scan usage charge.
- A service-role-only import ledger with unique `(guest_user_id, destination_user_id, source_document_id)` makes retries idempotent. Persist the generated destination id before file copying; retry the same target path, validate copied bytes before publishing a complete row, and mark that ledger item complete only after row and file agree. Incomplete targets must not appear as completed History entries. Handle partial batches without duplicate scans; never upsert over an unrelated existing document.
- Do not reassign or reset source/destination usage counters. Guest attempts already consumed remain counted under the guest owner; future processing uses the destination account's own quota. Do not promise quota continuity across identities or a global cap.
- Leave source records/files intact until the destination item is durably complete. Then remove its source photo/row idempotently; retain ledger progress so cleanup can be retried. Report `complete` only after import and source cleanup finish and no eligible guest documents remain. Do not delete the guest Auth user as part of this operation.
- Return a bounded progress summary (copied, pending and cleanup-pending counts, plus `complete`), not tokens or document text. Use 200 for progress/success, 400 for invalid request/source identity, 401 for failed authentication, 409 for pending guest work, and 500 for retryable copy/database/cleanup failures. Apply request throttling; expired source credentials require a recoverable session refresh or an explicit failure message, never a fabricated success.

The ledger, permissions and copy flow are required new implementation work. Protect ledger rows and any staging data from browser reads/writes. Server-only helpers must validate both identities on every retry. Test redirect cancellation, existing Google identity collisions, token expiry, cross-user attacks, partially copied photos and repeated imports before enabling "Save my history" for existing accounts.
