# Prompt 17 reports and moderation validation

Implemented locally on November 23, 2026. Ready for code review; database and
browser acceptance remain unverified. No commits, pushes, deployment, remote
migration, remote application-data writes, cleanup scripts, or real account
promotions were performed.

## Requirements and acceptance

[Prompt 17](../EchoVault_Copilot_Prompts.md) requires an admin-only panel with
users, reports, listings and demo Premium tools; secure RPCs/policies; manual
trusted-SQL admin bootstrap; user reports; report resolution; listing archival;
demo Premium assignment; and direct-API non-admin deny tests.

[Blueprint](../EchoVault_Project_Blueprint.md) sections 4.09, 6–7, F1–F3 and
T10–T16 make the requirements more specific:

- Users: read-only profiles with Set demo Premium; admin and Premium are
  independent. A protected RPC assigns 30-day demo Premium or Free using DB time.
- Listings: archive/restore. Only published/archived transitions are offered;
  admins cannot publish drafts. Restore requires public source metadata and a
  separate preview. Archive removes a listing from the public catalog without
  revoking an existing permanent purchase or unexpired rental.
- Reports: review/resolve; the existing schema permits `open` and `resolved`.
  Report reason is one text field of 1–1000 characters. No category enumeration
  or separate explanation field is specified. Users can read their own reports;
  administrators can read all reports; listing owners cannot read others' reports.
- Audit information specified by the schema is `created_at` and `resolved_at`.
  Resolution records database time once and preserves original report evidence.
  No separate audit table, resolver identity, suspension, deletion, or ban is
  required or added.
- Normal users must fail direct admin calls and role/plan escalation. Hiding
  controls or redirecting the page does not establish database authorization.

The requested duplicate prevention is one report per reporter/listing, including
resolved reports. Self-reporting is permitted because the documents do not ban
it. Existing rows, including any legacy duplicates, are preserved.

Git preflight: clean `main`; HEAD, tracked `origin/main`, and the read-only GitHub
`refs/heads/main` lookup all matched
`a407e9f48b5a762a3527bb63ece588e8a7f3f857`, the committed Prompt 16 implementation.
The linked local project reference is `zysyghbbbesatbehravb` (echovault-dev).
The initial implementation did not query live database schema/migration history; schema review used every
relevant checked-in migration, including current publication and checkout rules.

## Implementation and security

Listing details now has an accessible report form with reason validation,
existing-report lookup, loading/success/duplicate/error states and in-flight
submission suppression. Reporter identity, workflow status and timestamps come
from SQL, never caller parameters. All dynamic content uses text nodes.

The guarded admin page has Reports, Listings and Users tabs, keyboard tab
navigation, safe text rendering, refresh, empty/error/forbidden states, action
suppression and clearing on account changes. Admin navigation uses the database
role. Users cannot edit profile data or roles through the admin panel.

New forward-only migration:
[20261123150000_reports_and_moderation.sql](../supabase/migrations/20261123150000_reports_and_moderation.sql).
It creates seven narrowly scoped RPCs:

- `create_listing_report(p_listing_id, p_reason)`
- `admin_resolve_report(p_report_id)`
- `admin_moderate_listing(p_listing_id, p_status)`
- `admin_set_premium(p_target_user, p_plan)`
- `admin_list_users(p_offset, p_limit)`
- `admin_list_listings(p_offset, p_limit)`
- `admin_list_reports(p_offset, p_limit)`

Each SECURITY DEFINER function pins its search path. Admin functions check
`auth.uid()` and existing `private.is_admin()` before reads or writes. Execution
is granted only to `authenticated`, with an additional database role check for
admin operations; no browser role claim can authorize one. Read RPCs return
bounded metadata pages without emails or private audio paths. Legitimate base
table reads (public listing metadata, own role/plan/report/license) remain.

The migration revokes both table and old column grants for direct report writes.
Existing reporter/admin SELECT RLS remains. A non-unique pair index plus a
transaction advisory lock and a fresh READ COMMITTED duplicate check prevents
new duplicates without failing on or removing legacy duplicates. Reports reject
unavailable/draft/private listings, blank/oversized reasons and unsupported
control characters. Other transaction isolation levels are rejected safely.

Admin report resolution is retry-safe and never rewrites the first resolution
time. Moderation changes only listing status. Current owner permissions permit
archival only, so a seller cannot restore an admin-archived listing directly.
Plan changes use `now() + interval '30 days'` for Premium and null expiry for Free.
No new direct subscription/role write grants are introduced.

Licenses, recordings, versions, original/edited files, previews, Storage policies
and bucket settings are untouched. Admins receive no new private-audio access.
Services never access Storage or use a service-role key. Uncertain mutation
responses prompt a refresh; they do not trigger automatic repeated writes.

[Manual admin bootstrap template](../supabase/manual/bootstrap_demo_admin.sql)
is separate from migrations and disabled by default with a null target UUID.
It always aborts until deliberately configured in trusted SQL with both a verified
UUID and matching exact email. It promotes exactly one existing ordinary user or
rolls back, and was not run.

## Observed validation

| Check | Result | Limit |
|---|---|---|
| Prompt 17 services | PASS | Mocked Auth/RPC boundaries, validation, duplicates, own-report privacy, pagination, failures and unknown results |
| Prompt 17 report UI | PASS | Mocked DOM/services; form, duplicate/loading/success/error/forbidden states and safe text |
| Prompt 17 admin UI | PASS | Mocked DOM/services; guard ordering, tabs, actions, stale responses, account changes, empty/error/forbidden states |
| Admin navigation | PASS | Mocked DB-role lookup, ordinary/anonymous users, stale role responses and active link semantics |
| Prompt 17 SQL source contract | PASS | 67 checks; source inspection only |
| Prompts 13–16 regressions | PASS | All 19 scripts listed below; mocks and source contracts |
| Production build | PASS | All nine HTML entries, 99 modules |
| Changed/new JS syntax and `git diff --check` | PASS | Local syntax and whitespace checks |
| Actual SQL/RLS, concurrent requests and direct REST | SKIP | No local PostgreSQL/psql or Docker runtime; no database was contacted |
| Browser desktop/mobile/audio flows | SKIP | No browser flows were executed |
| Remote migration history and dry run | PASS in subsequent preflight | Nine earlier IDs synchronized; only Prompt 17 pending; details below |
| Remote schema catalog parity | SKIP | Migration history does not establish absence of out-of-band schema changes |

No unresolved local test failures. Node experimental VM-module notices and Git
LF/CRLF notices are informational. Passing mocks and source checks are not proof
that SQL compiles or that live RLS/Storage enforce the intended policy.

## Reproduce local checks

Run these five new checks, then the 19 selected regressions. All are local-only;
do not run older API attack or cleanup scripts.

```powershell
node --experimental-vm-modules scripts/test-moderation-services.mjs
node --experimental-vm-modules scripts/test-listing-report-ui.mjs
node --experimental-vm-modules scripts/test-admin-ui.mjs
node --experimental-vm-modules scripts/test-admin-navigation.mjs
node scripts/test-prompt17-sql-contract.mjs
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

## Disposable account manual procedure

Use an **isolated local Supabase**, never a shared development or primary
database for these write tests. When Docker, Supabase CLI and psql are available,
start the local stack, apply migrations locally, and point the local Vite app's
ignored environment configuration at its local URL and public key. Confirm the
host is `127.0.0.1`/`localhost` before every SQL or write test. The checked-in
development link alone does not mean the browser is using a local database.

1. With a trusted local SQL connection, run
   `psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/prompt17_reports_moderation.sql`
   (verify the port against local configuration). Expect assertions to finish
   and both transactions to roll back. Fixtures include seller, reporter,
   unrelated user, permanent buyer, renter, expired renter and admin. This suite
   checks RLS, grants, forged roles/plans, transitions, timestamps and unchanged
   license/object snapshots; it does not deliver actual audio bytes.
2. Register separate disposable browser accounts for Seller, Reporter, Unrelated,
   Buyer, Renter and Demo Admin. Record their local UUIDs. Bootstrap only the
   disposable local Demo Admin through a deliberately configured copy of the
   manual SQL template. Verify it still has a Free subscription. Never execute
   the template against a real account or the primary echovault project.
3. As Seller, save a consented original recording of at least 12 seconds. Publish
   it from My Library with a separate 5–8 second preview and Buy/Rent offers.
   As Buyer complete Demo Buy; as Renter complete Demo Rent. Confirm both can
   play/download full audio while Unrelated can use only the public preview.
4. As Reporter, open listing details and Report. Check blank, whitespace-only,
   oversized and unsupported-control input is rejected (service/direct RPC for
   inputs the native form prevents). Submit a valid reason, click rapidly, and
   refresh: one report, clear success/existing-report feedback, no identities.
   Use two local browser sessions/tabs of Reporter to submit concurrently: one
   succeeds and the other gets duplicate code `23505`; verify one database row.
5. As Unrelated and Seller, `/admin.html` must show forbidden. In DevTools use
   `const { supabase } = await import('/src/js/config/supabaseClient.js')` and call
   each `admin_list_*` RPC, `admin_resolve_report`, `admin_moderate_listing` and
   `admin_set_premium` directly with the fixture UUIDs and documented parameter
   names above. Expect `42501`. Direct report insert/update, role update and
   subscription update must also fail. Selecting another reporter's known
   report ID must return no rows, including for the listing owner. This is
   authorized negative testing only on the disposable local database.
6. As Demo Admin, review all tabs. Resolve Reporter's report, confirm database
   `resolved_at`, repeat the call and verify that timestamp and reason remain
   unchanged. Reporter still sees their resolved-report state and cannot report
   the same listing again. Grant Reporter demo Premium and verify expiry equals
   DB time plus 30 days; Set Free must clear it. Reporter remains role `user`.
7. As Demo Admin archive Seller's listing. It must disappear from Marketplace;
   Buyer and Renter must retain full-audio playback/download. Seller still owns
   the source and cannot restore it through direct table update. Admin Restore
   should return the listing; drafts/private sources/invalid target statuses
   must be rejected. Check no licenses, audio or previews disappeared.
8. Sign out and attempt direct report/admin RPCs with the anonymous client: all
   must fail, and the admin URL redirects to Login. Test offline/error/retry,
   empty tabs on a clean fixture database, rapid action clicks, keyboard tabs
   and focus, desktop and 375px width, and signout/account switch during requests.
   Expired-rental and exact-version checks are covered by the rollback suite;
   actual HTTP expiry delivery needs a disposable local expired-license fixture.

## Files and review gate

Modified:

- `admin.html`
- `src/js/pages/adminPage.js`
- `src/js/pages/voiceDetailsPage.js`
- `src/js/components/navbar.js`
- `scripts/test-marketplace-ui.mjs`

Created:

- `src/js/components/adminPanel.js`
- `src/js/components/listingReport.js`
- `src/js/services/adminService.js`
- `src/js/services/reportService.js`
- `src/js/services/moderationClient.js`
- `scripts/test-admin-ui.mjs`
- `scripts/test-admin-navigation.mjs`
- `scripts/test-listing-report-ui.mjs`
- `scripts/test-moderation-services.mjs`
- `scripts/test-prompt17-sql-contract.mjs`
- `supabase/migrations/20261123150000_reports_and_moderation.sql`
- `supabase/tests/prompt17_reports_moderation.sql`
- `supabase/manual/bootstrap_demo_admin.sql`
- `docs/prompt17-validation.md`

Before a commit, review the diff and new RPCs, execute the isolated SQL/RLS suite
and disposable browser/REST checks, fix any failures, then obtain explicit commit
authorization. The new UI needs the migration before it can work against a
database; no migration has been applied remotely. Any future remote application
requires separate explicit approval and verified echovault-dev targeting.
Prompt 18 remains outside scope.

## Final migration preflight

Result: **SAFE TO APPLY after explicit approval**, based on source security review
and the successful read-only migration preflight. No blocking migration defect
was found, and the pending migration SQL was not changed during this preflight.
The manual bootstrap template was hardened to require a matching verified UUID
and email and exactly one ordinary-user role row. It remains disabled and was
not executed. Its updated source checks pass (73 total).

Both requested commands succeeded on November 23, 2026:

```powershell
npx.cmd supabase migration list --remote
npx.cmd supabase db push --dry-run --remote
```

Both identified `echovault-dev` / `zysyghbbbesatbehravb`. The CLI labels this cloud
project's environment `production`; this is still the verified development
project, not the separate primary `echovault` project. The nine synchronized
versions are `20261121174900`, `20261121181600`, `20261121183500`,
`20261121202000`, `20261122180000`, `20261122210000`, `20261123120000`,
`20261123130000` and `20261123140000`. Only
`20261123150000_reports_and_moderation.sql` is pending. Dry run explicitly stated
that migrations would not be pushed, and reported empty seed/role changes.
Initial sandbox attempts could not write the CLI telemetry cache; the same
commands succeeded with approved execution outside the sandbox.

New database objects are the seven `public` RPCs listed above and the non-unique
`public.reports_listing_reporter_idx` index on `(listing_id, reporter_id)`.
All seven functions are SECURITY DEFINER with an empty search path. Only
`authenticated` receives EXECUTE, after revocation from PUBLIC, anon,
authenticated and service_role. Six admin functions also check the current
authenticated UID and its stored `admin` role before any operation. The reports
table loses all direct INSERT/UPDATE/DELETE table privileges and old column
INSERT/UPDATE grants for PUBLIC/anon/authenticated, and the two old report-write
policies are removed. Reporter/admin SELECT RLS and all other table/Storage
grants and policies remain in place. No new table, role, bucket, helper replacement
or automatic role assignment is introduced.

The SECURITY DEFINER functions deliberately perform their own checks because
their trusted owner can bypass caller RLS. Dependencies and return types match
the nine earlier checked-in migrations. Ordinary users retain permitted public
creator-profile fields and their own data, but cannot obtain admin list results,
change roles/plans, resolve reports, or restore listings. A seller's existing
archive-only permission is preserved. Source validation, pair serialization,
database timestamps, idempotent resolution, UTC Premium expiry and status-only
moderation passed review. License helpers and private Storage policies are
unchanged. Neither migration history nor dry run compiles the new PL/pgSQL bodies,
executes RLS/REST/concurrency tests, or proves absence of out-of-band schema drift.
Those runtime checks remain unverified.

### Development account preparation after separate approval

Do not run these steps automatically. Before any development writes, verify the
dashboard project is `echovault-dev` and its address contains
`zysyghbbbesatbehravb`; confirm the app's Supabase URL matches that project.
Never use the primary `echovault` project. Apply the reviewed migration only
after its own explicit approval, before testing the new RPCs.

1. Register ONE NEW disposable development-only Demo Admin through ordinary
   signup, using a new controlled test email. Do not reuse Free User A, seller
   User B, existing Premium testers or any real account. Complete email
   confirmation. Copy the exact UUID and stored email from this newly created
   entry in Supabase Auth Users. Record its creation time to distinguish it from
   existing accounts. Signup must initially create role `user` and plan `free`.
2. In the verified development project's trusted SQL Editor, perform this
   read-only identity check after replacing both placeholders with those copied
   values. Expect exactly one row, role `user`, plan `free`, and the new account's
   expected creation time. Stop on any mismatch.

```sql
select u.id, u.email, u.created_at, p.display_name, ur.role, s.plan, s.expires_at
from auth.users as u
join public.profiles as p on p.id = u.id
join public.user_roles as ur on ur.user_id = u.id
join public.subscriptions as s on s.user_id = u.id
where u.id = '<VERIFIED_NEW_UUID>'::uuid
  and u.email = '<EXACT_VERIFIED_NEW_EMAIL>';
```

3. In a private copy of `supabase/manual/bootstrap_demo_admin.sql`, set
   `v_demo_admin_id` to that UUID and `v_demo_admin_email` to that exact email.
   Keep the repository template null/disabled. After explicit approval for this
   one account, run the copy only in the verified trusted development SQL Editor.
   It aborts on missing values, mismatched identity or any result other than one
   ordinary-user promotion, and does not change its subscription or content.
4. Repeat the read-only query: only this new UUID must now have role `admin`;
   its subscription stays Free. Sign in afresh to the application. No admin
   signup field, role-setting API/RPC, or normal-client role update is provided.

### Minimal disposable browser and direct API checks after approval

Use NEW disposable Seller, Reporter/Buyer, Renter, Unrelated and Plan Target
accounts in addition to the new Demo Admin. Record all new UUIDs and the one new
listing/report IDs before mutations. Keep all existing fixtures and purchases
untouched. Use new consented audio and new demo licenses only; retain the test
artifacts rather than running cleanup scripts.

1. New Seller publishes one disposable listing with its separate public preview.
   New Reporter/Buyer and Renter acquire new demo buy/rent licenses. Record
   successful full-audio playback/download as their baseline.
2. Reporter submits a valid report: one `open` row with its own reporter UUID and
   DB creation time. Resubmit through UI and direct RPC; expect duplicate
   `23505`. Whitespace/control/oversized reasons are rejected (`22023`), malformed
   UUIDs fail type validation (`22P02`), and absent/unpublished listings fail
   (`P0002`). New Seller and Unrelated cannot select Reporter's report row.
3. In a NORMAL disposable user's local Vite DevTools console, import the app's
   public-key Supabase client and call these exact functions directly, using only
   the newly recorded IDs. All six admin calls must return `42501`, even with
   forged user metadata or an active Premium subscription. Anonymous calls also
   fail. Ordinary role/plan/report direct writes must fail; a SELECT of the
   unrelated report ID must return zero rows.

```javascript
const { supabase } = await import('/src/js/config/supabaseClient.js')
await supabase.rpc('admin_list_users', { p_offset: 0, p_limit: 100 })
await supabase.rpc('admin_list_reports', { p_offset: 0, p_limit: 100 })
await supabase.rpc('admin_list_listings', { p_offset: 0, p_limit: 100 })
await supabase.rpc('admin_resolve_report', { p_report_id: '<NEW_REPORT_UUID>' })
await supabase.rpc('admin_moderate_listing', { p_listing_id: '<NEW_LISTING_UUID>', p_status: 'archived' })
await supabase.rpc('admin_set_premium', { p_target_user: '<NEW_PLAN_TARGET_UUID>', p_plan: 'premium' })
```

4. Demo Admin can open all three tabs. Resolve only the new report. Verify DB
   `resolved_at`, unchanged reason/reporter/created_at, and unchanged resolution
   time after retry. Resolving alone must leave listing status unchanged.
5. Demo Admin archives only the new listing: catalog entry disappears. New Buyer
   and Renter retain full-audio playback/download; seller retains its source;
   Unrelated and unlicensed Admin are denied private audio. Seller cannot restore
   it directly. Admin restores it; preview/catalog return. Compare new fixture
   recording/version/preview/license IDs before and after: unchanged.
6. Demo Admin uses only NEW Plan Target for Premium then Free. In trusted SQL
   verify Premium has `expires_at = updated_at + interval '30 days'` and
   `plan='premium'`; `has_active_premium()` is true as that target. Free sets
   `expires_at` null and eligibility false. The target's role stays `user` and
   it cannot change its own or anyone else's plan directly. No existing Premium
   tester or Free User A is modified.
7. Check forbidden normal-user admin URL, anonymous login redirect, keyboard and
   mobile layout, loading/empty/error/retry and rapid clicks. Existing licensed
   audio may be checked read-only, without changing those listings, licenses,
   expiries or objects. Expired-rental/concurrency and full SQL/RLS execution
   remain separate runtime checks until actually executed.

This preflight changed only the manual bootstrap template, its static source
tests and this validation record. It did not apply migrations, execute bootstrap,
run live mutation tests, commit, push, deploy or start Prompt 18.
