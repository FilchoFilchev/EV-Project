# Prompt 12 — Offline Export and Premium

## Documented requirements

The exact Prompt 12 instruction in `EchoVault_Copilot_Prompts.md` is:

> Implement OfflineAudioContext rendering to an actual WAV Blob, upload it as a new private voice version, and store effect_type/settings metadata. Add Premium-only UI and a server-side policy/check preventing Standard users from inserting edited versions. Ensure no fake UI-only processing. Add an API attack test trying to insert edited version as Free user.

The Blueprint adds the relevant acceptance criteria:

- D2: the generated WAV plays after download and after opening it again.
- D3 / T06: Standard cannot create an edited version through a direct API request.
- D3 / T07: Premium can save a Muffle version as a new Storage file and `voice_versions` row.
- Originals remain immutable, with exactly one original per recording.
- Effects/export require active Premium, including for an administrator. Plan and role are independent.

Listings, public previews, checkout, and admin Premium tools belong to later prompts.

## New migration and setup

`supabase/migrations/20261122210000_edited_voice_versions.sql` is forward-only and does not change existing rows, files, buckets, grants on versions, or older migrations. It exposes `has_active_premium()` for the UI and adds restrictive validation to future edited-version inserts. The existing `private.is_premium()` helper checks `expires_at > now()` on the database; an expired or null-expiry Premium subscription is inactive. There is no administrator bypass.

The new policy requires an owned recording with a saved original, an owned UUID WAV path, valid intensity metadata, and an uploaded private object whose MIME and size match the inserted metadata. The existing unique Storage-path index forces each version to use a separate file. Existing version privileges prohibit modifying originals; existing Storage policies prohibit overwriting audio and deleting referenced files.

Remote application requires explicit approval and must target **echovault-dev**, reference `zysyghbbbesatbehravb`. Never apply this work to the primary `echovault` project. No remote migration is applied by this task.

For browser verification, use dedicated demo accounts. An active Premium demo user must already have a `premium` subscription with a future, non-null expiry. If needed, a trusted operator can assign that plan to a **new dedicated demo account only** after approval. Prompt 12 does not add self-upgrade or admin plan-management functionality. Never modify the saved recording named `Test` or existing Marketplace fixtures.

## Automated local checks

```powershell
node scripts/test-audio-engine.mjs
node scripts/test-audio-upload-validation.mjs
node scripts/test-audio-export.mjs
node --experimental-vm-modules scripts/test-edited-save.mjs
node scripts/test-edited-library.mjs
node scripts/test-studio-premium.mjs
node scripts/test-prompt12-api-safety.mjs
npm.cmd run build
git diff --check
```

Run `node --check <file>` for the changed JavaScript modules and scripts as well. These tests make no network requests. A successful mocked/unit test is not evidence that the remote policy was applied. The VM-based service test uses Node's built-in experimental VM modules and may print the expected experimental-feature warning; no test dependency is installed.

`supabase/tests/prompt12_edited_versions.sql` is a separate **local-only**, rollback-only SQL test. Run it against an isolated local Supabase database with all migrations applied, using a trusted SQL role and stop-on-error enabled. It generates new temporary fixture users, recordings, and Storage metadata, tests real authenticated RLS, then rolls back. It checks Free, active, expired, null-expiry and Free-admin eligibility; Premium positive save; invalid object metadata; cross-owner insertion; object reuse; and immutable original metadata. It neither uses nor modifies the Prompt 09 test fixtures, and it does not upload actual Storage bytes. If SQL tooling/local Supabase is unavailable, report this test as not run.

## Dedicated direct API attack

Do not rerun the Prompt 09 integration runner or any cleanup script. The independent runner below targets only echovault-dev and never deletes anything. It intentionally retains one new unreferenced WAV object, prints its path, and stops on unexpected results.

1. Create a new disposable original under an ordinary Free demo account, titled `Prompt12 disposable API attack`. Use **Save original** in Studio and obtain its recording UUID from the owned library/database.
2. Create the ignored local file `supabase/tests/.env.prompt12.local` with these values; never commit credentials:

   ```dotenv
   SUPABASE_TEST_URL=https://zysyghbbbesatbehravb.supabase.co
   SUPABASE_TEST_PUBLISHABLE_KEY=<publishable-key-only>
   PROMPT12_FREE_EMAIL=<dedicated-free-demo-email>
   PROMPT12_FREE_PASSWORD=<dedicated-demo-password>
   PROMPT12_FREE_USER_ID=<verified-existing-disposable-user-a-uuid>
   PROMPT12_DISPOSABLE_RECORDING_ID=<new-disposable-recording-uuid>
   ```

3. After reviewing/approving the target and applying the migration, run:

   ```powershell
   node --env-file=supabase/tests/.env.prompt12.local scripts/verify-prompt12-api.mjs --confirm-echovault-dev
   ```

4. Expect three `PASS Free direct REST insert denied` lines for Muffle, Distortion, and Echo, each with HTTP `403`, PostgreSQL error `42501`, and a row-level-security message naming `voice_versions`. Generic permission-denied, missing-object, uniqueness, validation, and network errors are failures, not evidence of the Premium protection. The test verifies the session against the expected existing disposable User A UUID/email and confirms the source is private, belongs to that Free user, has exactly one original, and uses the disposable title prefix. It uploads a new valid WAV first, so object-existence checks do not mask the attack. Postflight checks confirm the source version list is unchanged and the attack path has no version reference. It does not touch `Test`, existing Marketplace fixtures, existing audio files, subscriptions, or roles.

### Retained artifacts and manual cleanup

Each runner execution creates one 16,044-byte WAV in private `voice-files`, at the exact `<User A UUID>/<new UUID>.wav` path printed before upload. It never overwrites or automatically removes any object. Sign-in/out also creates normal Auth session/audit activity. Any separately prepared disposable original has its own Storage object and recording/version rows; record those identifiers separately and retain them.

After the result has been reviewed and cleanup separately approved:

1. Use only **echovault-dev** (`zysyghbbbesatbehravb`). Copy the exact attack WAV path from the specific run; never use a folder, wildcard, or a path inferred from a title.
2. Perform a read-only check that **no** `voice_versions.storage_path` equals that complete path. Also check the file is the expected new 16,044-byte object under User A. Retain it if any check fails, an insert unexpectedly succeeded, or the upload/save result is uncertain.
3. Using the authenticated disposable User A, remove only that exact unreferenced WAV through the Storage API, or use the Storage dashboard after the same checks. The existing Storage policy rejects deletion of referenced audio. Never delete rows directly from managed `storage.objects`.
4. Verify that only the approved object was removed. Leave the disposable source original, its metadata, the account, `Test`, and Marketplace fixtures intact. Source/account cleanup requires a separate dependency-aware review. Never run Prompt 09 cleanup scripts for this task.

This is a manual plan, not an instruction to run cleanup automatically.

### Real API verification — November 22, 2026

Executed the dedicated Prompt 12 runner once against **echovault-dev** using the existing disposable Free User A (`207f9dbf-ae7e-42eb-9925-9fb371724e97`) and a publishable browser key. Preflight verified role `user`, plan `free`, and `has_active_premium() = false`.

| Attempt | Result | HTTP | SQLSTATE |
|---|---|---|---|
| Muffle edited insert | PASS — denied by RLS | 403 | 42501 |
| Distortion edited insert | PASS — denied by RLS | 403 | 42501 |
| Echo edited insert | PASS — denied by RLS | 403 | 42501 |

All three responses contained: `new row violates row-level security policy for table "voice_versions"`. Postflight confirmed the source version list was unchanged and no edited row was created by the attacks. Premium browser success was separately confirmed by the project owner.

A separate read-only artifact audit confirmed zero version references to the attack path across User A's accessible versions, exactly one source version (the original), byte-for-byte equality of the original against its generated fixture, and retention of the expected 16,044-byte attack WAV. No cleanup was executed.

The retained temporary **attack WAV** is 16,044 bytes in private bucket `voice-files`:

```text
207f9dbf-ae7e-42eb-9925-9fb371724e97/4b33d735-ee6b-4acf-9b97-303920117a24.wav
```

No Prompt 12 source existed for User A, so preparation created a separate disposable one-second original using the existing original-save RPC. Retain these fixture artifacts:

- Recording: `c281613a-fce7-48b0-a1ee-9a7a86bfb53e`
- Original version: `fbcee889-d009-4ee4-ae6c-b60e6f42fdb8`
- Original Storage path: `207f9dbf-ae7e-42eb-9925-9fb371724e97/63e376e8-8bb1-431e-a962-d6fb6a9d80a4.wav`

The ignored local `supabase/tests/.env.prompt12.local` contains the runner configuration and credentials; never commit or print it. No real recordings, `Test`, Marketplace fixtures, subscriptions, or migrations were changed. No cleanup or Prompt 09 test was run.

For cleanup approval, first perform this **read-only** query in echovault-dev and require zero rows:

```sql
select id, recording_id, effect_type
from public.voice_versions
where storage_path = '207f9dbf-ae7e-42eb-9925-9fb371724e97/4b33d735-ee6b-4acf-9b97-303920117a24.wav';
```

After separate approval, remove only the attack WAV through authenticated User A's Storage API and confirm removal. Leave the referenced source original and its rows intact; do not use SQL to delete Storage metadata or bulk-delete the user's folder.

### Prepared exact-object cleanup procedure — not executed

The cleanup script is `scripts/cleanup-prompt12-attack-wav.mjs`. It defaults to read-only preflight, authenticates with the existing ignored configuration and publishable/anon key, and pins both User A and the single attack path. Importing its validation helper from the attack runner does not run the attack suite.

**Resolve project identity first:** the separately supplied reference `zysyghbbesatbehravb` differs from the linked project, ignored configuration, and successful API target, which all use **`zysyghbbbesatbehravb`**. The script rejects the different reference. Confirm the intended dashboard project is echovault-dev with the verified reference before any execution approval. No deletion is authorized by this document.

1. From the repository, run the read-only preflight after confirming the reference:

   ```powershell
   Set-Location -LiteralPath 'F:\GitHub\EV Project'
   node --env-file=supabase/tests/.env.prompt12.local scripts/cleanup-prompt12-attack-wav.mjs --preflight --project-ref=zysyghbbbesatbehravb
   ```

   Require `result: PASS`, `mode: preflight`, `removed: false`, the exact User A UUID/path, MIME `audio/wav`, size `16044`, and zero visible version references. It also verifies the referenced source original and downloads both WAVs. It never calls Storage removal in this mode.

2. Independently open **echovault-dev** in the Supabase SQL Editor. Verify the dashboard URL reference is `zysyghbbbesatbehravb`, select its trusted `postgres` role, and run only `supabase/tests/prompt12_attack_cleanup_preflight.sql`. This file contains one read-only SELECT. Require `global_scope_verified = true` and `attack_global_references = 0`. The output's `project_ref` is an explicit confirmation label, not automatic discovery of the SQL Editor connection; the dashboard identity check is mandatory.

3. Copy/export the single actual SQL result as JSON to the ignored file `supabase/tests/.prompt12-cleanup-sql-confirmation.local`. A one-element JSON array or a single JSON object is accepted. Do not create or edit values to simulate confirmation. The script binds the result to the exact project, bucket, and attack path, and rejects results older than 15 minutes or materially in the future.

4. Obtain explicit approval to remove **only** the attack WAV. The visible-reference preflight cannot substitute for the separate global SQL Editor check. Keep User A idle during the final SQL check and removal; rerun the SQL check if its confirmation expires.

5. **Only after identity confirmation, real global SQL confirmation, and explicit cleanup approval**, execute:

   ```powershell
   node --env-file=supabase/tests/.env.prompt12.local scripts/cleanup-prompt12-attack-wav.mjs `
     --project-ref=zysyghbbbesatbehravb `
     --execute `
     --approve-exact-path=207f9dbf-ae7e-42eb-9925-9fb371724e97/4b33d735-ee6b-4acf-9b97-303920117a24.wav `
     --sql-editor-confirmation=supabase/tests/.prompt12-cleanup-sql-confirmation.local
   ```

   The only deletion call is authenticated Storage `.remove([ATTACK_PATH])`, with one hardcoded exact path. No wildcard, folder, SQL deletion, migration, subscription, recording/version change, or attack-suite rerun is performed. Existing Storage authorization also globally denies deletion of referenced audio.

6. Require `removed: true`, `absenceVerified: true`, and `sourceBytesAndReferenceUnchanged: true`. The script requires exactly one correctly named removal response, verifies a genuine missing-key result (not an authentication/network error), and checks the preserved original's bytes and metadata reference. If any result is uncertain or fails, stop; the script never retries deletion automatically. Leave every other object and fixture intact.

Local safety validation (mock clients; no network or actual cleanup):

```powershell
node scripts/test-prompt12-cleanup.mjs
node --check scripts/cleanup-prompt12-attack-wav.mjs
node --check scripts/test-prompt12-cleanup.mjs
git diff --check
```

## Manual browser checks

Use new disposable recordings for all steps.

1. Signed out, open `studio.html`; expect login redirection.
2. As Free, record/import and play audio, save its original, and verify My Library playback/download still work. Effects, intensity, and edited saving should explain the Premium requirement and stay locked. Manipulating controls in DevTools must not permit an edited database insert; run the dedicated attack above for the server check.
3. As active Premium, record/import a short audio sample, save its original, select Muffle at 50%, preview, then save the edited version. Verify a new WAV file and edited row appear alongside the unchanged original with effect/settings metadata. Refresh My Library, play the saved WAV, download it, and open the download in an external audio player. The effect must remain audible after refresh/download.
4. Repeat edited saving with Distortion and Echo at low/high intensity. Check that Echo retains its audible ending, playback levels remain reasonable, each save uses a new file/version, and the original still sounds unchanged. Reset must restore Original preview.
5. Attempt edited saving before saving the original; expect clear guidance to save the original first. Attempt saving with Original selected; expect no edited version to be created.
6. Simulate a network failure during upload/save. Expect a visible error, restored controls, and preserved original. Restore connectivity and retry. A save whose response is uncertain must not trigger deletion of an object that may have been referenced successfully.
7. Use a dedicated expired Premium account (and a Free administrator if available); effects/export must stay locked. If Premium expires while Studio is open, the next save must fail safely through the database entitlement check/RLS.
8. At desktop and a narrow mobile viewport, verify controls remain usable, messages are readable, and navigation between Studio/My Library preserves the established navbar/footer layout.
9. In a second demo user's browser session, try downloading the newly created Premium user's WAV through the Storage API using its exact path. Expect an error and no Blob. The other user's edited version must also be absent from My Library. Use only the new disposable recording for this check.

## Changed files

Modified:
- `studio.html`
- `my-library.html`
- `src/js/pages/studioPage.js`
- `src/js/pages/myLibraryPage.js`
- `src/js/services/audioEngine.js`
- `src/js/services/storageService.js`
- `src/js/services/voiceRecordingService.js`

Added:
- `src/js/services/subscriptionService.js`
- `src/js/services/editedVersionService.js`
- `supabase/migrations/20261122210000_edited_voice_versions.sql`
- `supabase/tests/prompt12_edited_versions.sql`
- `scripts/test-audio-export.mjs`
- `scripts/test-edited-save.mjs`
- `scripts/test-edited-library.mjs`
- `scripts/test-studio-premium.mjs`
- `scripts/test-prompt12-api-safety.mjs`
- `scripts/verify-prompt12-api.mjs`
- `docs/prompt12-validation.md`

The original-save error classifier was also moved to module scope, fixing an existing scope error when handling rejected original-save requests. A focused regression test checks that definitive rejection is reported correctly.

## Known trust boundary

The browser performs real rendering and WAV encoding. Database policies enforce ownership, active Premium, separate private-object references, and matching metadata. Browser code and arbitrary uploaded bytes cannot establish trusted proof that a particular effect was applied. This is the Blueprint's documented Capstone limitation; server-side processing/inspection belongs to a future production design.
