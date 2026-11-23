# Prompt 16 — Licensed Downloads

Implemented locally on November 23, 2026. The initial implementation run made
no commits or pushes. The user subsequently confirmed that core licensed audio
playback and download work in the browser and explicitly authorized the final
Prompt 16 commit and push. No deployment, remote migrations, cleanup, or
application-data changes are part of this finalization.

## Exact documented scope

`EchoVault_Copilot_Prompts.md`, Prompt 16:

> Implement a protected audio download flow. The owner or buyer with a valid license can download from the private voice-files bucket; other users cannot. Ensure expiring rental access uses DB time and that archived listings do not revoke existing perpetual buys. Use short-lived authorized URLs where needed, and add deny tests using a second user.

Read together with `AGENTS.md`, `.github/copilot-instructions.md`, and Blueprint
sections 2.3, 4 (My Library), 7, E4 and T05/T12–T14: exact-version nonexclusive
licenses, database-time rental validity, private full audio, separate public
previews, protected owner/licensed downloads, and archived license preservation.
This execution also adds the requested licensed playback and failure states.
Prompt 17 is excluded.

Git preflight: clean `main`; HEAD and local `origin/main` both
`3c71a8bf319afef469bec1e21104f0c5386d4cd4`. A successful read-only
`git ls-remote origin refs/heads/main` confirmed GitHub has the same revision.
That commit contains Prompt 15 checkout, license receipts, migration and tests.

## Implementation and security

- Acquired licenses has **Play full audio** and **Download full audio** actions.
  Rendering receipts never fetches full audio. Every action resolves the saved
  license again and downloads through authenticated `voice-files` Storage.
- The new service accepts only a license UUID. It verifies the user through
  Auth, queries their receipt, follows the database listing/version relationship,
  checks the exact version ID, and uses only persisted file metadata.
- Existing `private.has_valid_license_for_version` binds the JWT buyer to the
  listing's immutable version. Purchases require null expiry; rentals require
  `expires_at > pg_catalog.now()`. There is no listing-status condition.
  `private.can_access_audio_path` matches the exact persisted path, and existing
  restrictive Storage policies enforce that check on every authenticated fetch.
  Anonymous access and unrelated versions remain denied, including for admins
  without ownership or a license. Existing owner downloads remain available.
- **No new migration is necessary.** No applied migration, RLS policy, grant,
  bucket setting, or existing license service was changed. Private helpers keep
  their pinned search paths, limited execution grants and unexposed schema.
- An expired rental's receipt remains readable; RLS hides its version and can
  also hide an archived listing. The UI reports expired/unavailable rental
  rights after this server decision. Browser dates are presentation only.
- Storage rechecks authorization if the rental expires after the metadata read.
  A separate valid license for the same version can still authorize that audio;
  an expired receipt alone never does.
- Original WebM/WEBA, WAV, MP3, M4A and OGG extensions come from validated stored
  metadata and paths. No audio is transcoded. File size and MIME are checked;
  generic binary responses use the saved audio MIME. Filenames are sanitized.
- Full audio is represented in the DOM only by temporary local blob URLs. There
  are no public full-audio URLs, signed bearer URLs, raw Storage paths in UI,
  sensitive error messages, new secrets, or persisted audio caches.
- Overlapping action clicks are suppressed. Session changes, refresh, page exit
  and disposal invalidate stale responses and release players/blob URLs. A
  post-download Auth check also rejects account changes or session loss. Errors
  remain retryable; unavailable files never start a download.

Already delivered bytes cannot be revoked at rental expiry. Native replay of a
delivered blob and previously saved copies have the same limitation described
in the Blueprint. Every new action requires a new authorized request.

## Observed validation

| Check | Result | Evidence / limit |
|---|---|---|
| Prompt 16 service boundary tests | PASS | 222 assertions; own buy/rent, archive, hidden expired sources, cross-user/version mismatch, denied paths, formats, failures and session changes |
| Prompt 16 licensed audio UI | PASS | Loading/play/download, rapid clicks, retry, expired/unauthorized errors, safe URLs/text, stale responses, auth/page lifecycle cleanup |
| Updated acquired-license receipt regression | PASS | Prices, expiry display, archive history, loading/empty/error/refresh, no eager audio access |
| Prompt 16 SQL/security source checks | PASS | 51 checks of existing helpers, policies, grants, immutable relationships and rollback-suite coverage; source checks only |
| Prompt 15 regressions | PASS | License service, Demo Checkout UI, 47 SQL source-contract checks |
| Prompt 14 regressions | PASS | Marketplace UI, browse service and filters |
| Prompt 13 regressions | PASS | Listing validation, preview, service/UI, SQL source contract, preview upload policy/SDK request, Storage diagnostics |
| Original/edited library regression | PASS | Existing owner playback/download behavior |
| `npm.cmd run build` | PASS | Nine HTML entries, 94 modules |
| Changed/new JavaScript syntax; `git diff --check` | PASS | No syntax or whitespace errors |
| Actual PostgreSQL/RLS suite | SKIP | No local PostgreSQL/psql or Docker runtime; SQL was not executed |
| Core licensed browser playback/download | PASS (user-confirmed) | User manually tested the core functionality and reported that it works; this is separate from agent-executed local tests |
| Live negative Storage/RLS scenarios | SKIP | Agent did not execute live unauthorized, expired-rental, cross-version or archival security checks; core browser confirmation does not establish those results |
| Expanded browser checks: mobile, session changes and failure recovery | SKIP | Not separately confirmed by the user. Earlier agent automation stopped because it could not determine Chrome's URL confidently enough to enforce policy |

No unresolved local test/build failures. Node experimental VM warnings and Git
LF/CRLF notices are informational. Mocked tests and static checks are not proof
that the remote database matches the checked-in policies. User confirmation of
core browser playback/download does not imply that the live SQL/RLS suite or
all negative/manual scenarios below were executed.

Final commit validation reran the four Prompt 16/receipt scripts listed first
below, production build, all six changed/new JavaScript syntax checks, and
`git diff --check`: all passed. The earlier full 19-script regression results
remain recorded above; they are not represented as a second complete run.

## Reproduce focused local checks

```powershell
node --experimental-vm-modules scripts/test-licensed-audio-service.mjs
node --experimental-vm-modules scripts/test-licensed-audio-ui.mjs
node --experimental-vm-modules scripts/test-acquired-licenses-ui.mjs
node scripts/test-prompt16-sql-contract.mjs
node --experimental-vm-modules scripts/test-license-service.mjs
node --experimental-vm-modules scripts/test-demo-checkout-ui.mjs
node scripts/test-prompt15-sql-contract.mjs
node --experimental-vm-modules scripts/test-marketplace-ui.mjs
node --experimental-vm-modules scripts/test-marketplace-browse-service.mjs
node scripts/test-marketplace-filters.mjs
node scripts/test-listing-validation.mjs
node scripts/test-listing-preview.mjs
node --experimental-vm-modules scripts/test-listing-service.mjs
node scripts/test-listing-ui.mjs
node scripts/test-prompt13-sql-contract.mjs
node scripts/test-preview-upload-policy.mjs
node --experimental-vm-modules scripts/test-preview-upload-request.mjs
node scripts/test-storage-error-diagnostics.mjs
node scripts/test-edited-library.mjs
npm.cmd run build
git diff --check
```

`supabase/tests/prompt16_licensed_audio.sql` is for an **isolated local Supabase
database only**, after the existing migrations, using a trusted SQL connection
and `psql -v ON_ERROR_STOP=1 -f supabase/tests/prompt16_licensed_audio.sql`.
Confirm that the connection is local before running it. It creates disposable
metadata fixtures, tests RLS as multiple identities, archives a disposable
listing, and rolls everything back. It uploads no real media. Do not run it on
echovault-dev or rerun the older attack/cleanup suites.

## Manual browser checks using existing disposable accounts

Use the existing local dev URL (`npm.cmd run dev` if necessary), connected only
to echovault-dev (`zysyghbbbesatbehravb`). Use existing purchases/rentals; no new
checkout, license edits, archival, uploads or cleanup are needed for these steps.

1. As the existing buyer, open **My Library → Acquired licenses**. Play and
   download an existing purchase. Confirm full-length audio, the proper original
   extension (WebM stays WebM; edited WAV stays WAV), and a playable saved file.
2. Play/download an existing active rental. Rapidly click actions: one request
   should run, controls should recover, and refresh should clear the player.
3. If an expired rental already exists, try both actions: expect an expired
   access message and no delivered audio. If no fixture exists, use the isolated
   rollback SQL suite instead; do not alter existing expiry dates.
4. If an already archived listing has an existing valid license, repeat the
   buyer's actions; access must remain. Use the rollback SQL suite to test the
   actual seller-archive transition without changing Marketplace fixtures.
5. As the seller, confirm their original/edited library playback/download still
   works and public previews still work separately. With an account lacking a
   license, direct private Storage download of a known other-user file must be
   denied. Never publish the path, access token, or full audio URL.
6. Sign out and open `/my-library.html#acquired-licenses`: expect login protection.
   A private Storage request without authentication must also fail. Signout or
   switching accounts during a pending action must not expose its result.
7. Temporarily use browser offline mode during an action, restore connectivity,
   and retry: show a clear failure, then recover. Verify mobile width, keyboard
   access, audio controls, refresh and readable status messages.

## Files and finalization

Modified: `my-library.html`, `src/js/components/acquiredLicenses.js`,
`scripts/test-acquired-licenses-ui.mjs`.

Created: `src/js/services/licensedAudioService.js`,
`scripts/test-licensed-audio-service.mjs`, `scripts/test-licensed-audio-ui.mjs`,
`scripts/test-prompt16-sql-contract.mjs`,
`supabase/tests/prompt16_licensed_audio.sql`, and this validation record.

The user authorized committing and pushing only these Prompt 16 files after
final diff, security and essential-test review. Core manual browser testing is
user-confirmed. The live negative Storage/RLS scenarios and isolated rollback
SQL execution remain outstanding limitations; run the SQL suite when a local
database is available. There is no new migration to apply. Supabase data and
migrations, deployment, cleanup, and Prompt 17 remain outside this finalization.
