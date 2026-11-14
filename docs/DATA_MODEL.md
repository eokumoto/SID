# Data model

Supabase Postgres plus the private `scans` Storage bucket. RLS applies to every application table and the bucket. Every access is scoped to the authenticated owner, including anonymous authenticated users.

## Implementation status

The executable baseline is [20261113000000_init.sql](../supabase/migrations/20261113000000_init.sql). It creates `documents`, `profiles`, `usage`, the private bucket and owner policies. It includes an explicit `grant execute ... to service_role` for `bump_usage`.

The target schema and permissions below require **new migrations**; they are not implemented by that baseline. The initial `documents` policy allows owners to update every column and the initial usage function does not claim processing work. Do not ship the target API on those permissions. Keep executable SQL in migrations rather than maintaining a second SQL copy here.

## Target tables

### `documents`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key; generated before upload |
| `user_id` | uuid | Owner, defaults to `auth.uid()`; immutable |
| `created_at` | timestamptz | Server creation time; History sort only |
| `input_kind` | text | `image` or `text`; immutable |
| `input_text` | text | Original pasted input; immutable, null for images |
| `image_path` | text | Exactly `{user_id}/{id}.jpg`; null for text or after explicit photo removal |
| `photo_removed_at` | timestamptz | Null until an image original is explicitly removed |
| `title` | text | First nonempty source line, truncated to 80 characters |
| `gemini_source_text` | text | Gemini's read, preserved separately for images |
| `ocr_text` | text | Text used by the accuracy check; for pasted input, copied from `input_text` |
| `ocr_source` | text | `paste`, `vision` or `gemini`; null until ready |
| `plain_text` | text | Model rewrite; not changed by review notes |
| `flags` | jsonb | Validated array of [API flags](API.md#stored-flag-shape-and-corrections) |
| `key_terms` | jsonb | Model-supplied candidate names; not guaranteed complete |
| `warnings` | jsonb | Array of short codes, e.g. `vision_disabled`, `vision_unavailable`, `original_removed` |
| `status` | text | `queued`, `processing`, `ready`, `failed`; default `queued` |
| `processing_started_at` | timestamptz | Server time of latest claim; used for 2-minute expiry |
| `attempt_id` | uuid | Server-generated token for conditional completion/failure writes |
| `error` | text | Short failure code from [API.md](API.md#responses), never document text |

New image rows require the exact image path, no `input_text`, and no removal timestamp. New text rows require nonempty `input_text`, no image path and no removal timestamp. Server validation and database constraints enforce the input shape and size. An image path may become null only through explicit removal; this does not turn an image document into a pasted-text document.

### `profiles`

`user_id` is the owner primary key. `settings` is a JSON object for saved reader settings (add-on). Owners can read, create, update and delete their own profile under RLS.

### `usage`

Primary key `(user_id, day)`; `day` uses the UTC calendar date and `scans` is a nonnegative integer. Owners can read their usage but have no insert, update or delete access. Only the service-role processing transaction writes it. Failed admitted attempts count; duplicate requests and reads of ready documents do not. See [API.md](API.md#processing-lifecycle-and-usage).

### Storage bucket `scans`

Private JPEG files at `{user_id}/{document_id}.jpg`, limited to 5 MiB per object. Owner policies constrain the first path segment. The API additionally validates the **entire** derived key before any service-role download or deletion. Owner RLS on a document does not establish ownership of a path stored inside it.

Generate signed view URLs for about 5 minutes and refresh while the photo remains available. Do not store signed URLs in rows or logs. Photos remain available until explicit removal; there is no automatic deletion or "Keep photo" toggle in core. Explain this on Scan before upload.

## Guest ownership and import ledger

Guests are anonymous Supabase users with private rows/files, not public unauthenticated database clients. The same document permissions apply to guests and registered users. Do not reject an anonymous user just because they have no Google/email identity. Guest recent scans are tied to that browser session; signed-in History is recoverable by account login.

A new-account upgrade keeps the user id and existing records. Existing-account login uses the privileged, dual-identity [history import](API.md#guest-history-import), which copies records and photos to new destination-owned ids/paths; no browser owner reassignment. Add a server-only `guest_history_imports` ledger with guest id, destination id, source document id, reserved destination document id, progress state and timestamps. Uniqueness on the three source/destination identifiers makes retries idempotent. Enable RLS with no browser policies, revoke direct browser grants, and reserve writes/reads for the import route. Keep incomplete target data private until ready for History.

There is no guest-expiry cleanup in core. Losing a browser session can make scans inaccessible without deleting their server records/files; explain this distinction. Explicit guest deletion uses the same owned file/row procedures below.

## Required follow-up migrations

Before building the target API:

1. Add the lifecycle, immutable input, OCR provenance, warning and removal fields above, plus check constraints. For existing rows, backfill input kind and preserve text inputs before changing defaults; require non-processing rows or an explicit maintenance plan during migration. Existing rows must not be silently reprocessed.
2. Replace unrestricted browser document mutations. Allow owner SELECT and DELETE under RLS; permit INSERT only for input columns (`id`, `user_id`, `input_kind`, `input_text`, `image_path`), with server defaults for all processing/output columns. Revoke broad browser UPDATE privileges. Enforce the exact image key in database constraints too. Defaults for all server fields must allow valid queued inserts.
3. Add a service-role-only atomic claim-and-reserve RPC implementing the state/quota table in [API.md](API.md#processing-lifecycle-and-usage). Lock the document, serialize usage reservation across different documents for the same account/day, and enforce the server-configured limit. Retire separate `bump_usage` use. Explicitly revoke RPC execution from public, anon and authenticated; grant it to service_role.
4. Add owner-scoped RPCs for flag review and photo-removal metadata. These validate `auth.uid()`, allow only the documented transitions and reject unrelated field changes. Photo-removal metadata may be changed only for terminal `ready`/`failed` rows; review only for `ready` rows with an available original. Lock the row so review cannot race a removal. Security-definer RPCs need a fixed search path and explicit execution grants; never accept a caller-supplied owner id as authority.
5. Add the server-only guest-history import ledger, protected staging/publication behavior and idempotent progress constraints required by the import contract. Do not allow browser owner changes.
6. Add bucket MIME/size restrictions. Test all policies and RPC permissions with two users, anonymous auth, direct REST calls and the service role.

## Original retention and removal

Core saves uploaded photos until the user explicitly removes the photo or deletes the scan. The Scan screen says: "Your photo and text are stored until you delete them. Avoid private documents." Guests also see: "Guest scans are accessible only while this browser keeps your session. Sign up or log in to save your history across devices." There is no temporary-retention promise and no `keep_photo` field.

**Remove original photo** is available only for `ready` or `failed` image rows, after a warning that future checking and image Retry will be unavailable. Remove the exact owned Storage object first, then call the metadata RPC to clear `image_path`, set `photo_removed_at`, and add `original_removed`. If the file is already missing, treat removal as idempotent. If either step fails, show incomplete removal and let the user retry; never report success until both finish. The API rechecks source availability and conditional state before claiming Retry. For failed images, the removal RPC must reject an active/new processing attempt; if deletion raced a claim, that attempt fails with `storage_failed` and cannot resurrect the file.

OCR text and rewrite remain after photo removal. Show "Original photo removed; OCR may contain errors" rather than presenting OCR as the photo. Disable new flag review. A failed image without its photo requires a new scan; a ready document still opens without reprocessing. Pasted input remains available for checking until scan deletion.

## Delete

- **Delete scan:** remove the exact owned photo (if present), then delete the owned row. Treat an already missing file as success; surface partial failures and allow retry. Results only update existing rows, so in-flight processing cannot recreate a deleted scan. Processing workers never write files. File creation is limited to initial browser upload and the explicit history-import copy flow; unfinished imports remain subject to their ledger and retry rules.
- **Delete all scans and settings:** list all objects in the owner's folder, including orphan uploads, and remove them in paginated batches. Delete all owned document rows in batches and the profile. Pause new uploads in the current UI; recheck for remaining rows/files before reporting success and report incomplete cleanup if other sessions are still writing. Do not claim an atomic purge across active sessions.
- This bulk action retains the login account and daily usage counters. Say so beside the button. Do not label it "Delete all my data" or "Delete account". Account deletion is outside core and would require a separately designed privileged flow. Deleting app records also does not promise deletion of data already sent to providers.

## RLS test (Checkpoint 3)

With accounts A and B, including an anonymous account:

- [ ] A guest can scan/read/review/retry without an account login; session loss does not expose or automatically delete their data.
- [ ] New-account upgrade preserves the guest owner id; existing-account import verifies both identities, survives retries/cancellation and does not duplicate scans or reset quotas.
- [ ] Signing out clears the prior account's scans and signed photo URLs from UI/cache; new guest mode shows none of them.
- [ ] A cannot list/read B's rows, download B's objects or sign URLs for B's objects.
- [ ] A cannot set B's object path in A's document; the database and API reject it before any service-role access.
- [ ] A cannot set status, attempt id, timestamps, OCR, rewrite or usage through direct browser writes or privileged RPC calls.
- [ ] Review RPC changes only a known flag's review fields and rejects foreign documents, missing originals and arbitrary output changes.
- [ ] Concurrent duplicate processing calls run one attempt and reserve usage once; concurrent different documents respect the daily limit.
- [ ] Expired work can be retried; a late worker cannot overwrite the new attempt or a deleted row.
- [ ] Photo removal disables new review and failed-image Retry, while ready text remains readable.
- [ ] Deletion removes rows and files, handles partial failures, and bulk cleanup includes orphan uploads and more than one page of results.
