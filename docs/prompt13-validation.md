# Prompt 13 — Listings and Public Previews

Current status: all **eight local and remote migrations are synchronized** in **echovault-dev** (`zysyghbbbesatbehravb`), independently confirmed with `npx.cmd supabase migration list --remote` during final validation. Both `20261123120000_listing_public_previews.sql` and `20261123130000_preview_upload_authorization.sql` are applied; nothing is pending. The project owner confirmed successful real publication of a dedicated original with a generated 5-second WAV preview, sale-only EUR 1.00, and both confirmations checked. This browser result is owner-reported evidence, not an independently repeated upload. The failure diagnosis and earlier preflight records below are historical evidence.

## Final validation for the authorized GitHub commit — November 23, 2026

The final source/security review found no blocker. It verified server-side ownership, separate public previews/private full audio, integer EUR cents, SQL-fixed 30-day offers, unique publication, 5–8 second WAV generation, status-only archival, and anonymous write denial. The provisional-size correction changes only the existing upload-policy helper and retains the finalized publication checks. The commit scope is the 23 durable files listed in the Files section; environment files, local credentials, disposable audio, previous attack/cleanup artifacts, and ignored confirmation files are excluded.

| Check | Result |
|---|---|
| Eight Prompt 13 JavaScript suites | PASS |
| Six audio/Prompt 12 regression suites | PASS |
| Production build, all nine HTML pages | PASS |
| Syntax checks, all 15 changed/new JavaScript modules/scripts | PASS |
| Working whitespace check | PASS; staged whitespace is checked as a final commit gate |
| Migration history | PASS: eight local/remote versions match, none pending |
| Secrets/dependency/scope review | PASS: no real credentials or unexpected changes; no dependency additions |
| Dedicated real 5-second, EUR 1.00 sale-only publication | PASS, reported by project owner |
| Two rollback-only SQL runtime suites | SKIP: no isolated local PostgreSQL/Docker available |
| Live anonymous object retrieval/denial | SKIP: exact new preview/full-file paths not available; no guessed-object requests |
| Live mutation-denial and concurrency checks | SKIP: no remote writes or attack suites authorized |

The only local test warnings were Node's expected experimental VM-module warnings. No Prompt 09/12 attack runner, cleanup script, live upload, remote INSERT/UPDATE/DELETE, or database migration was run during final validation. No deployment or Prompt 14 work is included.

Separate safe security test plan, not executed: provision an isolated local Supabase database with all eight migrations, run both Prompt 13 SQL suites with stop-on-error, and require their assertions to pass before ROLLBACK. For eventual Storage HTTP write-denial and concurrency tests, use a separately approved disposable environment and new dedicated accounts/objects only; test anonymous/cross-owner upload, overwrite/move, and referenced-preview deletion denial without targeting any current recordings, listings, or licenses. Do not reuse Prompt 09/12 attack or cleanup scripts. Browser rent-only/combined offers, edited-version publication, archive/license survival, mobile/keyboard use, and audible crop content beyond the reported successful scenario remain manual checks, not independently verified results.

## Real upload failure diagnosis and local correction

The observed message originated in `publishVoiceListing()` immediately after the Storage SDK returned `uploadError`. Local preview validation, authentication, ownership, and duplicate checks had already passed. No publication RPC was submitted on that branch. A returned SDK error can also represent a transport/CORS failure; the original browser HTTP status/body was not available for inspection, and no live request was repeated.

The applied INSERT policy has a concrete lifecycle incompatibility: `private.can_upload_voice_preview()` requires finalized `metadata.size`, while Storage first checks permission with provisional MIME metadata lacking that field. This rejects a valid upload before file-body persistence. The linked cache reports Storage `v1.96.4`; its [official uploader source](https://github.com/supabase/storage/blob/v1.96.4/src/storage/uploader.ts#L83) shows provisional authorization before backend upload and a later check with finalized metadata. This explains the reported failure, but the specific failed request's HTTP status and Storage code remain uncaptured. The earlier static preflight missed this phase because its successful fixtures already supplied `size`.

The renderer and pre-upload validator enforce mono 16 kHz PCM16 WAV, `audio/wav`, an exact canonical header, and a real decoded crop of 5–8 seconds. Five seconds is **160,044 bytes**; eight seconds is **256,044 bytes**, inclusive of the bucket limit. A 44.1/48 kHz or stereo file fails locally before the Storage call. A new regression test runs the installed SDK against a fake fetch and verifies that FormData preserves the exact WAV bytes/MIME and `upsert: false` at both boundaries.

The new migration replaces only the existing invoker-security helper. Authentication, owner UUID folder, UUID `.wav` filename, MIME restrictions, and ACLs remain intact. Provisional metadata without `size` is allowed; an explicit `size` field, including null or invalid text, receives the original strict bounds/sample checks. The bucket's 256,044-byte cap, strict finalized-size check in the publishing RPC, and overwrite/delete policies remain unchanged. Multipart `contentLength` is intentionally not used as file size because it includes request overhead. No applied migration, remote object, recording, listing, or license was changed.

`storageErrorDiagnostics.js` now exposes actual HTTP status separately from legacy Storage status/code and returns controlled safe error descriptions. Arbitrary server text, URLs, headers, tokens, nested response bodies, and stacks are never echoed or logged. The publisher displays those safe diagnostics with validated size, duration, sample rate, channel count, and MIME. Unknown HTTP status is reported as unavailable, not guessed. Upload errors never trigger automatic retries, publication RPC calls, or cleanup.

Files changed for this correction:

- `src/js/services/marketplaceService.js`
- `src/js/utils/storageErrorDiagnostics.js` (new)
- `scripts/test-listing-service.mjs`
- `scripts/test-storage-error-diagnostics.mjs` (new)
- `scripts/test-preview-upload-request.mjs` (new)
- `scripts/test-preview-upload-policy.mjs` (new)
- `supabase/migrations/20261123130000_preview_upload_authorization.sql` (new)
- `supabase/tests/prompt13_preview_upload_authorization.sql` (new, local-only rollback test)
- `docs/prompt13-validation.md`

Focused checks for the correction:

```powershell
node scripts/test-listing-validation.mjs
node scripts/test-listing-preview.mjs
node scripts/test-storage-error-diagnostics.mjs
node scripts/test-preview-upload-policy.mjs
node --experimental-vm-modules scripts/test-preview-upload-request.mjs
node --experimental-vm-modules scripts/test-listing-service.mjs
node scripts/test-listing-ui.mjs
node scripts/test-prompt13-sql-contract.mjs
node scripts/test-audio-export.mjs
npm.cmd run build
git diff --check
```

Observed correction results: all nine listed local suites passed; the installed-SDK fake-fetch suite includes eight cases. All six changed/new JavaScript files passed syntax checks. The production build and final `git diff --check` passed. Only expected Node VM experimental warnings appeared. No live upload, remote SQL, cleanup, commit, push, or deployment was performed.

The SQL regression suite exercises real authenticated INSERT policies for provisional and finalized metadata, both size boundaries, invalid metadata, cross-owner/anonymous denial, and overwrite denial. It is prepared for an isolated local database only and remains **unexecuted**, because no local PostgreSQL/Docker tooling is available. The JavaScript policy-contract test is static source validation, not SQL execution. The project owner subsequently applied the correction and confirmed that the real browser publication succeeded. No live upload was repeated by the final-validation agent.

The planned single browser retest was completed successfully by the project owner using the dedicated original, 5-second preview, sale-only EUR 1.00, and both confirmations. Do not republish that version or delete its artifacts. For any separately authorized future reproduction, use a new dedicated version, click Publish once, and stop on failure; share only safe HTTP/Storage diagnostics and WAV size, never headers, cookies, tokens, or full URLs. Do not test on `Test` or existing marketplace fixtures.

## Documented scope

The exact instruction in `EchoVault_Copilot_Prompts.md` is:

> Implement publishing a user-owned voice version to a Marketplace listing with euro-cent prices, demo sale/rental options, 30-day rental, and a 5–8 second public preview stored separately from the paid private file. Require ownership and a public source recording. Validate file size, preview length, and prices. Archived listings must not break existing licenses.

Relevant Blueprint acceptance criteria:

- E1: an owned public version can be offered with a price; full audio stays private.
- T08: the published listing has a working preview; the full file is not public.
- T14: archiving a listing preserves issued licenses.
- Business rules: a listing offers sale, rent, or both; rent is 30 days; prices are positive integer euro cents; one listing per version; creators explicitly confirm rights and consent.
- My Library provides Publish and My listings/Archive actions. Publishing is available to Free and Premium users; creating a new edited version still requires Premium.

Catalogue cards/search/detail are Prompt 14. Demo Checkout and license issuance are Prompt 15. Licensed-download UI is Prompt 16. None is implemented here.

## Repository baseline and safety

Before editing, `main` and GitHub `refs/heads/main` both pointed to `33893884f97fb9431901fe299e355bce88889ac0` (`Premium/Free account functionalities/access`). The worktree was clean. That commit includes Prompt 12 implementation, its sixth migration, tests, and `docs/prompt12-validation.md`.

Implementation and preflight stages performed no remote database/Storage changes, deployment, commit, push, attack-suite execution, or cleanup. The project owner later applied both migrations and authorized a selective Prompt 13 commit/push after final validation. Existing migrations, the recording `Test`, Premium versions, marketplace fixtures, and all existing user data are preserved by the final-validation work.

## Publishing workflow

From Original recordings or Edited versions, choose Publish, select a preview start and a length from 5 to 8 seconds, and generate/listen to the excerpt. The browser downloads only the authenticated owner's selected private version, decodes its real audio, and renders a new mono PCM16 WAV at 16 kHz. Changing the excerpt invalidates the generated preview.

Choose demo sale, 30-day demo rent, or both. Enter EUR amounts with at most two decimal places. The service parses decimal strings into integer cents without floating-point price arithmetic. At least one positive price is required, with PostgreSQL's integer maximum as the upper bound. Explicitly confirm publication of the source recording's metadata and rights/consent before publishing. The full audio object remains in private `voice-files`.

The new preview uses a random `<owner UUID>/<UUID>.wav` path in public `voice-previews`, never the source filename or private path, with `upsert: false`. The publication RPC checks the authenticated owner and object metadata, makes the source metadata public, and creates the listing in one transaction. Duplicate publication is rejected. An uncertain save is reconciled where possible and is never reported as confirmed success without a listing result.

My listings shows the owner's listings and public excerpts. Archive changes only the listing status. It retains private audio, preview files, listing identity, and license records. Existing owner/license authorization helpers do not depend on published status, so archival preserves permanent buys and unexpired rentals. Archival does not revoke copies of previews already served publicly.

## Versioned migrations and setup

`supabase/migrations/20261123120000_listing_public_previews.sql` is a new forward-only migration. It adds the public WAV-only preview bucket, narrowly scoped Storage policies, nullable preview-duration metadata for new publications, and the checked publication RPC. It does not rewrite legacy fixture rows or require their placeholder preview paths to become real files. Existing licenses and private-file authorization remain intact.

The RPC is callable only by authenticated users, pins `search_path`, derives ownership from `auth.uid()`, validates both confirmations and prices, and fixes EUR/30-day terms on the server. Direct listing INSERT is revoked; direct listing UPDATE is limited to owner archival. Referenced previews cannot be overwritten or normally removed through client Storage permissions.

Publication and unused-preview cleanup use the same transaction advisory lock. The cleanup policy's volatile helper checks listing references after obtaining that lock, coordinating concurrent publication and cleanup. This concurrency behavior has been reviewed statically, not exercised against PostgreSQL in this environment.

Do not apply this migration remotely without the project owner's explicit approval. The verified development target is **echovault-dev**, reference `zysyghbbbesatbehravb`. The original task text and these notes previously omitted one `b`; the read-only preflight below verified the actual project name/reference against the linked CLI target and ignored local configurations. Never target the primary `echovault` project. No change to Auth configuration, roles, subscriptions, or secrets is needed.

Both Prompt 13 migrations are now applied in echovault-dev. A fresh environment must apply the complete migration chain, including the provisional-metadata correction, before publishing can work. No migration was applied by the final-validation agent.

## Validation

The focused tests use local mocks and generated audio buffers, with no network or user-data access:

```powershell
node scripts/test-listing-validation.mjs
node scripts/test-listing-preview.mjs
node --experimental-vm-modules scripts/test-listing-service.mjs
node scripts/test-listing-ui.mjs
node scripts/test-prompt13-sql-contract.mjs
```

Relevant regression checks:

```powershell
node scripts/test-audio-engine.mjs
node scripts/test-audio-upload-validation.mjs
node scripts/test-audio-export.mjs
node --experimental-vm-modules scripts/test-edited-save.mjs
node scripts/test-edited-library.mjs
node scripts/test-studio-premium.mjs
npm.cmd run build
git diff --check
```

Observed local results: all five new suites and all six listed regression suites passed. The production build passed for all nine HTML entries. JavaScript syntax checks passed for all eleven changed/new modules and scripts, and `git diff --check` passed. The VM-based service tests printed Node's expected experimental-feature warning; there were no test failures. No dependency was added. Review and a secret-pattern scan found no added credentials. These local tests use mocks for browser/Supabase boundaries and do not establish real API security or audible browser playback.

The new rollback-only SQL suite, `supabase/tests/prompt13_listings_previews.sql`, is intended for an isolated local Supabase database with all seven migrations applied. It creates its own transaction-local fixture users/metadata and ends with ROLLBACK. It must not be run against the shared remote project as part of this task. No local PostgreSQL, psql, or Docker executable is available in this environment, so SQL/RLS execution and real Storage delivery cannot be claimed here. The static SQL security-contract test is a source check, not PostgreSQL execution.

## Read-only migration preflight — November 23, 2026

Verdict: **SAFE TO APPLY to the verified echovault-dev project**, subject to the existing requirement for explicit approval. This is a source review and read-only migration plan check, not a claim of executed new RLS or media integration tests. No migration was applied and no application data was changed.

The actual SQL, services, audio renderer, UI/controller, validators, and test sources were reviewed, including independent SQL and JavaScript reviews. No blocking security/correctness defect was found. The only local fix during preflight was correcting the target-reference typo in this document. All six previously applied migration files remain unchanged.

`supabase/.temp/project-ref`, `.env.local`, `supabase/tests/.env.prompt12.local`, and `supabase/tests/.env.rls-test.local` all match `zysyghbbbesatbehravb`; the ignored files remain ignored. Only URL hostnames were inspected for comparison; credentials were not printed. Both remote CLI commands identified their target as `project echovault-dev (zysyghbbbesatbehravb)`, with environment label `production` within that development project.

Read-only commands and observed results:

```powershell
npx.cmd supabase migration list --remote
npx.cmd supabase db push --dry-run --remote
```

Both exited successfully. The first sandboxed list attempt was blocked by the CLI's local telemetry-cache write; rerunning the same read-only command with approved permissions succeeded. The dry-run explicitly stated that migrations would not be pushed, selected only `20261123120000_listing_public_previews.sql`, and returned `dryRun: true`, `seeds: []`, and `roles: []`. No real push, relink, cleanup, deployment, commit, or Prompt 14 work was performed.

| Version | Local | Remote |
|---|---|---|
| `20261121174900` | Present | Applied |
| `20261121181600` | Present | Applied |
| `20261121183500` | Present | Applied |
| `20261121202000` | Present | Applied |
| `20261122180000` | Present | Applied |
| `20261122210000` | Present | Applied |
| `20261123120000` | Present | **Pending** |

The migration adds one nullable column, `public.listings.preview_duration_seconds`; one public bucket, `voice-previews` (WAV-only, 256,044-byte maximum); and these four functions:

- `private.can_upload_voice_preview(text, jsonb)` — caller/path/MIME/size policy check, invoker security.
- `private.can_delete_unreferenced_preview(text)` — narrowly scoped definer helper, caller-owned path and no listing reference, including archived listings.
- `private.valid_listing_preview(uuid, text, numeric)` — internal definer helper; no client EXECUTE grant.
- `public.publish_voice_listing(uuid, text, numeric, integer, integer, boolean, boolean)` — definer RPC with explicit authenticated ownership/confirmation/validation checks; EXECUTE only for authenticated callers.

All functions pin `search_path`; the private schema is not exposed in the Data API. Only the two policy helpers receive authenticated EXECUTE, and only SELECT is granted on the new duration column. Publication revokes existing direct listing INSERT and column INSERT grants. Listing UPDATE grants are reduced to `status`, enforced by the new `listings_owner_archive` policy. No new table, index, trigger, extension, role, or subscription entitlement is created.

The ten new Storage policies are `voice_previews_select_owner`, `voice_previews_select_scope`, `voice_previews_select_deny_anon`, `voice_previews_insert_owner`, `voice_previews_insert_scope`, `voice_previews_insert_deny_anon`, `voice_previews_no_update`, `voice_previews_delete_unreferenced_owner`, `voice_previews_delete_scope`, and `voice_previews_delete_deny_anon`. They affect the preview bucket; other buckets gain no new permissive access.

| Operation | Enforced authorization |
|---|---|
| Fetch public preview URL | Public bucket delivery needs no authentication; metadata SELECT remains owner-only. |
| Preview upload | Authenticated caller's UUID folder and UUID WAV filename; WAV MIME metadata; 160,044–256,044 bytes, with whole PCM16 samples. |
| Overwrite or move preview | UPDATE denied for authenticated and anonymous callers; upload uses `upsert: false`. |
| Delete preview | Authenticated path owner only; no listing may reference it, including an archived listing. Publication and cleanup share a transaction lock. |
| Publish listing | RPC derives owner from `auth.uid()` and the version/recording join; both confirmations required; source becomes public before the listing INSERT in the same transaction. |
| Prices and terms | At least one integer price in 1–2,147,483,647 cents; sale-only, rent-only, or both; EUR and 30 days fixed by SQL. |
| Archive listing | Owner-only status update to `archived`; no file/version/listing/license deletion and no price/version reassignment. |

The existing private `voice-files` bucket, anonymous full-file denial, private-file access policies, and license helpers remain untouched. License access still depends on buyer identity and a permanent buy or unexpired rental using database time, not on the listing's published/archived status. Existing fixture rows are not rewritten or revalidated.

All five focused suites and six regression suites were rerun and passed during preflight. The production build passed for all nine HTML pages. The only test warnings were Node's expected experimental VM-module warnings. `git diff --check` passed after the documentation correction.

Remaining verification limits: the dry-run lists pending work without executing the new SQL; SQL runtime, advisory-lock concurrency, actual authenticated Storage mutation requests, anonymous HTTP preview delivery, and audible browser playback are untested here. The SQL fixture suite inserts Storage metadata as a trusted role and does not itself prove Storage upload/update/delete policy behavior. Actual WAV header/content, decoded length, and derivation from the chosen audio segment are validated in the browser; SQL checks MIME/size/duration metadata and object references. Storage upload and SQL publication are separate operations, with reconciliation and conservative orphan retention for uncertain results.

## Files

Modified:

- `README.md` — links to these implementation/setup notes.
- `my-library.html` — publisher form and My listings tab.
- `src/css/library.css` — responsive publishing/listing styles.
- `src/js/pages/myLibraryPage.js` — publishing entry points and lifecycle integration.
- `src/js/services/audioEngine.js` — additive public-excerpt renderer.
- `scripts/test-edited-library.mjs` — a publisher double for the existing library regression test.

Created:

- `src/js/components/listingPublisher.js`
- `src/js/services/marketplaceService.js`
- `src/js/utils/listingValidation.js`
- `src/js/utils/storageErrorDiagnostics.js`
- `supabase/migrations/20261123120000_listing_public_previews.sql`
- `supabase/migrations/20261123130000_preview_upload_authorization.sql`
- `supabase/tests/prompt13_listings_previews.sql`
- `supabase/tests/prompt13_preview_upload_authorization.sql`
- `scripts/test-listing-validation.mjs`
- `scripts/test-listing-preview.mjs`
- `scripts/test-listing-service.mjs`
- `scripts/test-listing-ui.mjs`
- `scripts/test-prompt13-sql-contract.mjs`
- `scripts/test-storage-error-diagnostics.mjs`
- `scripts/test-preview-upload-policy.mjs`
- `scripts/test-preview-upload-request.mjs`
- `docs/prompt13-validation.md`

## Manual browser scenarios after approved migration application

1. Use a new dedicated Free demo recording of at least 10 seconds. In My Library choose Publish; generate a 5-second excerpt starting at 1 second. Listen and confirm it matches that section, rather than the full recording.
2. Publish with demo sale EUR 12.34 and rent disabled. Confirm both checkboxes are required, the result appears in My listings after reload, the database stores `1234` cents/EUR/30 days, and the source metadata is public.
3. Use a different new recording for rent-only EUR 1.50, then another version for both options. Confirm rent is always labeled 30 days and there is no payment or checkout operation.
4. With an existing authorized Premium demo account, publish a dedicated edited version. Confirm the excerpt contains the saved effect, the original and edited private files stay separate, and no new Premium entitlement is granted.
5. Try empty prices, zero, negative, exponent notation, more than two decimal places, excessive price, no enabled option, unchecked consent, and a source shorter than 5 seconds. Confirm clear errors and no publication.
6. Try preview starts below zero or beyond the audio, lengths below 5 or above 8, and a range extending beyond the decoded source. Change crop controls after generating; a fresh preview must be required. Confirm a new generated preview replaces/revokes the old local playback URL.
7. Attempt publishing the same version twice. Confirm only one listing exists. Simulate offline/network failure during publish; verify My listings before retrying and do not remove files after an uncertain save.
8. Sign in as another demo user. Confirm their My listings contains only their listings and direct publication of another user's version is denied. Confirm a guessed full-audio URL or authenticated download without ownership/license is denied, while the short public preview URL plays.
9. Archive a dedicated new listing. Reload My listings and confirm Archived status, unchanged preview/private files, and no deletion of listing/license rows. In an isolated test database, verify a pre-existing buy and unexpired rental still authorize the exact version after archive; an expired rental remains denied. Do not alter the real marketplace fixtures for this check.
10. Check keyboard navigation, labeled form errors, loading states, and narrow/mobile layout. Existing original/edited playback and downloads must still work. As a guest, My Library must redirect to login.

## Limits

The browser verifies actual decoded excerpt duration and canonical WAV bytes before uploading. Storage/PostgreSQL can enforce ownership, MIME metadata, byte size, canonical size/duration consistency, prices, and file references, but cannot decode uploaded media bytes. A deliberately forged direct Storage upload would require trusted server-side media decoding to prove its actual duration/content. This task does not introduce a media-processing server.

Public preview URLs are public by design. Archiving hides an offer from the published catalogue; it does not make an already public preview confidential. No checkout, rental-expiry creation, search/detail UI, or remote migration is included in Prompt 13.
