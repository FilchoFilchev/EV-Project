# Prompt 15 — Secure Demo Buy/Rent

Local implementation and source review completed on November 23, 2026. No remote migration, remote data mutation, deployment, commit, or push was performed. The separate primary EchoVault project was not accessed.

## Final security preflight — November 23, 2026

Verdict: **SAFE TO APPLY for the documented demo-checkout contract**, pending explicit migration approval. The actual RPC, all eight preceding schema/policy migrations, license service, checkout confirmation UI, license receipts and rollback SQL suite were reviewed. Buyer/seller/offer/price authorization, locking, permanent-buy uniqueness, active-rental reuse, atomic failure handling and archive-independent license checks have no remaining source-review blocker. Existing recordings, licenses, subscriptions, Storage policies and applied migrations are unchanged.

One expiry issue was fixed in the unapplied migration: the RPC now has function-level `SET timezone = 'UTC'`. PostgREST permits a caller-selected [timezone preference](https://docs.postgrest.org/en/stable/references/api/preferences.html#timezone), and PostgreSQL calendar-day intervals can otherwise cross daylight-saving changes. The required `now() + interval '30 days'` calculation is retained and now yields exactly 2,592,000 elapsed seconds regardless of the caller's timezone. Function settings apply on entry and restore on exit; see [PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html).

The READ COMMITTED requirement is compatible with [PostgREST's documented transaction behavior](https://docs.postgrest.org/en/stable/references/transactions.html#isolation-level): POST calls to a VOLATILE RPC use a read/write transaction, normally at READ COMMITTED. The RPC checks `current_setting('transaction_isolation')`; it does not attempt `SET TRANSACTION` or change default isolation inside an existing transaction. A deployment overriding isolation receives a fail-closed `25000` error.

Confirmation is enforced in the browser UI. The exact required two-argument RPC cannot attest that a checkbox was clicked: a valid authenticated buyer can call it directly and receive a demo license after all database checks. This is the documented no-payment demo mechanism, without a server-side consent/payment record. Do not represent the checkbox as a database authorization gate.

Observed read-only CLI checks both succeeded against **echovault-dev (`zysyghbbbesatbehravb`)**; the local linked reference also matches. `npx.cmd supabase migration list --remote` shows all eight earlier migrations applied and only `20261123140000` pending. `npx.cmd supabase db push --dry-run --remote` explicitly reports `dryRun: true`, only `20261123140000_demo_checkout.sql` under migrations, and empty seeds/roles arrays. The CLI labels this development project's environment `production`; its project name/reference are the verified development project. No migration was applied.

After the narrow SQL correction: **PASS 47 static security-contract checks**, JavaScript syntax for the updated source-check script, and whitespace checks. Prior client/build/regression results below were not rerun. **SKIP** SQL/RLS/rollback/concurrency and new timezone runtime assertions: no local PostgreSQL runtime is available. A dry run lists the migration; it does not execute or validate its SQL against live data.

Preflight-adjusted files: `supabase/migrations/20261123140000_demo_checkout.sql`, `supabase/tests/prompt15_demo_checkout.sql`, `scripts/test-prompt15-sql-contract.mjs`, and this validation record. The SQL suite now checks timezone configuration, UTC during the actual license insert, caller timezone restoration, and exact elapsed rental duration under a non-UTC caller timezone. Only the unapplied migration was edited.

## Requirements and scope

Sources: `EchoVault_Copilot_Prompts.md` Prompt 15; Blueprint sections 2.3, 4 (details/library), 6, 7.2–7.3, 10, E3 and T09/T14; `.github/copilot-instructions.md`; `AGENTS.md`.

- Exact RPC: `public.demo_checkout(p_listing_id uuid, p_license_type text)` returns a license UUID.
- Verified `auth.uid()` buyer; seller resolved through listing → immutable version → recording. Require published listing, public parent recording, offered `buy`/`rent`, positive DB price, and buyer different from seller.
- Accept no client price, buyer, seller or expiry. Save integer euro-cent price snapshot. Buy is perpetual and nonexclusive; rent expires at database `now() + interval '30 days'`.
- Reject duplicate permanent purchases. Perform checks and license insertion atomically. Only authenticated callers receive EXECUTE; direct license mutations remain prohibited by grants/RLS.
- Clearly identify Demo Checkout and require confirmation: “No real money will be charged”. This demo creates a license without a payment table, provider, card details or real payment step.
- Integrate details-page actions and show issued receipts in My Library; present loading, failure, success and authorization states. Preserve licenses on archival.
- Preserve applied migrations, media, subscriptions and historical licenses. Prompt 16 downloads and Prompt 17 moderation are excluded.

## Implementation and retry rules

New migration: `supabase/migrations/20261123140000_demo_checkout.sql`. No existing migration is changed. It adds one SECURITY DEFINER RPC with an empty pinned search path and explicitly scoped EXECUTE. Existing license SELECT policy, permanent-buy unique index, FK restrictions and database-time license helpers are retained. The migration changes function/table privileges without rewriting application data or Storage.

Checkout locks the recording first, then the listing. This order matches publication and serializes concurrent checkouts, source visibility changes, offer updates and listing archival. Price/conditions are read from the locked database rows. READ COMMITTED is required; other transaction isolation levels fail closed with SQLSTATE `25000` to prevent a stale snapshot from defeating repeated-rental detection. Supabase/PostgREST's normal READ COMMITTED request transaction is supported.

An active rental retry returns the same license ID, original price and unchanged expiry. Expired rentals remain in history; a subsequent successful rental creates a new row. A permanent license blocks another purchase or redundant rental. A buy after a rental is allowed. Archived/unpublished/private-source listings reject new checkout while keeping issued licenses.

The service verifies the user, snapshots own matching receipt IDs, and submits only the two required RPC parameters. A lost/malformed response is reconciled only when a new matching own receipt appears. Existing rental history cannot prove a new checkout. Unresolved outcomes direct the user to My Library and stop further checkout on that page. No automatic mutation retry occurs. A confirmed UUID remains successful even if receipt metadata cannot be loaded.

## Observed local results

| Check | Result | Evidence/limit |
|---|---|---|
| Initial branch/tree/history | PASS | Clean `main`; fresh `git fetch origin main`; HEAD and origin/main both `8e6b6660449bef4098034a935505551d8db43071`; Prompt 14 present in HEAD |
| License service tests | PASS | Mocked buy/rent, verified auth, exact RPC arguments, abuse/errors, repeated/ambiguous requests, expired history, archived receipts and paging |
| Demo Checkout UI tests | PASS | Consent, cancel, trusted receipt, duplicate submit suppression, success/errors/authorization, safe text and private audio exclusion |
| Acquired licenses UI tests | PASS | Saved prices/expiry, archived/expired history, missing metadata, loading/error/empty/refresh states; no download controls |
| Prompt 15 SQL source checks | PASS | Static contract only; does not execute PostgreSQL or prove RLS/concurrency |
| Prompt 14 essential regressions | PASS | Marketplace UI, browse service and filters |
| Prompt 13 essential regressions | PASS | Listing validation, preview rendering, service/UI, SQL source contract, preview policy source checks, SDK upload request and storage diagnostics |
| Existing library regression | PASS | Original/edited playback/download test with unrelated license component stubbed |
| Production build | PASS | `npm.cmd run build`, nine HTML pages |
| Relevant JS syntax; whitespace | PASS | `node --check` for changed/new JavaScript; `git diff --check` |
| PostgreSQL execution: buy/rent, authorization, forged parameters, direct mutations, duplicate/repeated requests, expiry, price snapshots, RLS, archive survival, forced rollback and isolation rejection | SKIP | No local PostgreSQL/psql or Docker available; rollback-only SQL regression written but not executed |
| Concurrent multi-session database execution | SKIP | Locking reviewed in source; requires a local database and simultaneous connections |
| Live schema/data compatibility | SKIP | Compared against all eight existing local migrations; no remote database inspection or mutation was performed |
| Real desktop/mobile browser integration | SKIP | Automated DOM boundary tests ran; full integration awaits approved migration and manual testing |

No unresolved local test/build errors. One existing SDK-request test was initially invoked without its required `--experimental-vm-modules` flag; rerunning with the correct flag passed. Node's experimental VM warnings and Git's LF/CRLF notice are informational.

## Reproduce local checks

Run each command from the repository root. These scripts use dependency mocks or source checks and perform no network/database mutation.

```powershell
node --experimental-vm-modules scripts/test-license-service.mjs
node --experimental-vm-modules scripts/test-demo-checkout-ui.mjs
node --experimental-vm-modules scripts/test-acquired-licenses-ui.mjs
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

The new `supabase/tests/prompt15_demo_checkout.sql` creates fresh disposable fixtures and a forced-failure trigger inside transactions that end in ROLLBACK. Run it only on an isolated LOCAL Supabase database with all nine migrations, using a trusted owner connection and `psql -v ON_ERROR_STOP=1 -f supabase/tests/prompt15_demo_checkout.sql` with an explicitly local connection URL. Do not run it against the shared development or primary database. It does not upload real media and does not test HTTP Storage delivery. No reset/cleanup or old attack suite is needed.

For local concurrency testing, use a dedicated published/public listing and a different test buyer. In session A, begin a READ COMMITTED transaction, set the authenticated buyer's JWT claims, call `demo_checkout` for `rent`, and leave the transaction open. In session B, use the same buyer/listing and call rent; it must wait. Commit A: B must return the same UUID with exactly one new rental row and unchanged expiry. Repeat with buy: the second request must fail `23505`. Separately hold a recording visibility update or listing archive lock before checkout: after the change commits, checkout must fail `P0002`. If checkout holds its lock first, the later archive must preserve the issued license. Use only disposable local fixture records.

## Exact manual browser steps

Perform mutation steps only after separate migration approval/application to **echovault-dev (`zysyghbbbesatbehravb`)**. Use dedicated demo accounts/listings; preserve existing fixtures and files. Until then checkout should show a migration-required error without claiming success.

1. Run `npm.cmd run dev` and open the printed localhost URL. Sign out; navigate directly to `/voice-details.html?id=<published-listing-uuid>` and `/my-library.html#acquired-licenses`. Confirm login protection and no checkout/receipt data exposed.
2. Sign in as seller A. Open A's published listing. Demo Buy/Rent must be disabled with an own-listing explanation. Existing public preview must still work; full audio must remain private.
3. Sign in as different buyer B (Free is sufficient). Marketplace → View details on A's dedicated sale offer. Click **Demo Buy**: no license should be issued yet. Click Cancel and verify no receipt. Reopen, confirm **No real money will be charged**, then click **Confirm Demo Checkout**. Confirm loading/disabled actions, success with a UUID, and the saved demo price. Clicking rapidly must not submit twice.
4. Click **View acquired licenses**. The Acquired licenses tab must open and show the same UUID, saved EUR price, issue timestamp and perpetual nonexclusive terms. Reload; it must remain. Check mobile width and keyboard access to actions, checkbox, tabs and refresh.
5. Reload the listing as B and try Demo Buy again: expect a clear already-owned error and no second buy row. Demo Rent after a buy must also fail without another license.
6. Use a separate dedicated listing/buyer for rental. Select **Demo Rent · 30 days**, confirm, and complete checkout. Verify receipt and DB row: `expires_at = created_at + interval '30 days'`, trusted rental price and JWT buyer. Reload and repeat rent: the UUID, row count and expiry must stay unchanged. There is no rental-extension UI.
7. Open sale-only and rent-only listings; only the offered action must appear. In a second seller session archive a dedicated listing after the buyer loads its details; the stale buyer checkout must show unavailable and issue no license. A newly opened archived/nonpublic/invalid UUID detail URL must show unavailable.
8. For direct negative API checks on disposable fixtures, open DevTools and import the same configured browser client: `const { supabase } = await import('/src/js/config/supabaseClient.js')`. Inspect `await supabase.rpc('demo_checkout', { p_listing_id: '<uuid>', p_license_type: 'buy', p_price_cents: 1 })`: extra parameters must be rejected. Try extra buyer/seller/expiry arguments and invalid type similarly. Calling the valid two-argument RPC as the seller must fail; calling after sign-out must fail. A direct `supabase.from('licenses').insert(...)` or update/delete must fail. These rejected attempts must leave no new/changed license.
9. After a dedicated purchase/rental, archive that listing through seller A → My Library → My listings → Archive → Confirm. Buyer B's receipt must persist with original price/expiry after refresh. Existing public previews and private source objects must not be deleted. New checkout must fail. No licensed download behavior is added here.
10. In an isolated local database, run the rollback SQL suite for expired rental, mutation permissions, current-price snapshots, cross-buyer RLS, forced transaction failure and non-READ-COMMITTED denial. Check an expired receipt remains visible and does not authorize through the existing DB-time helper. Browser clock changes must not influence issued expiry. Use the local multi-session procedure above for concurrent retries.
11. For failure feedback, temporarily use DevTools offline mode before checkout and confirm a clear auth/network error with no false success. Restore the connection, refresh My Library, and reconcile any uncertain result before manually retrying. A missing checkout RPC must report setup required. The automated suite separately simulates a response lost after commit.

## Review and commit gate

Review the new migration and all source changes. Approve remote migration separately; apply only to the verified development reference above, then verify migration history. Run the isolated SQL suite/concurrency checks where PostgreSQL is available and complete the browser steps. Resolve failures before committing. No approval/application/commit is implied by this local implementation.

Known limits: the required two-argument RPC has no request ID, so rental retries are idempotent only while the existing rental is valid; after expiry a successful checkout is a new rental. Direct SQL callers using other isolation levels are deliberately rejected. Client-side tests/source checks are not evidence of live DB enforcement. Downloads and moderation remain later prompts.
