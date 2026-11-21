# EchoVault RLS Policy Test Plan

Run `rls_policies.sql` only against a disposable local Supabase database or a
development project, using a trusted database-owner connection. The script
switches to the actual `authenticated` and `anon` database roles before each
test block, sets test JWT claims in that trusted session, and rolls back all
fixture changes. This is a database-side test harness, not a way for browser
clients to choose their JWT identity. Do not run it against production.

Before release, also exercise the same cases through the Supabase API using
real JWTs for each test account. A privileged SQL Editor query without
`SET LOCAL ROLE authenticated` does not test RLS.

## Test identities and fixtures

Create these test accounts through Supabase Auth so the signup trigger creates
their profiles, roles, and subscriptions. Their email addresses are used by
the repeatable SQL test script:

- User A / Free: `rls-user-a@example.test`
- User B / Free: `rls-user-b@example.test`
- Active Premium: `rls-premium-active@example.test`
- Expired Premium: `rls-premium-expired@example.test`
- Premium with `NULL` expiry: `rls-premium-no-expiry@example.test`
- Admin: `rls-admin@example.test`; assigned through the test script's trusted
  setup only
- Licensed buyer: `rls-licensed-buyer@example.test`
- Anonymous: no access token

The SQL script creates its test recordings, versions, listings, and licenses
inside a transaction, and rolls them back. Use only disposable test accounts.

Run from the repository root with a local/dev database URL:

```powershell
psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_policies.sql
```

The script fails immediately if any account or bootstrap row is missing, if
the current database role cannot create fixtures, or if an allowed/denied
assertion has the wrong result.

The regression assertions specifically use `INSERT ... RETURNING id` for
recordings, original versions, and Premium-edited versions. They also verify
the active role, JWT `sub` setting, and `auth.uid()` for User A before testing.

## Real-session API fixtures (echovault-dev only)

The JavaScript API test uses the disposable standard User B account as the
fixture seller and User A as the buyer. It expects one marker-specific
published listing, one draft, and one archived listing. To prepare them:

1. In Supabase Dashboard, select **echovault-dev** and verify its project
   reference matches the project reference in
   `supabase/tests/.env.rls-test.local`. Never run either fixture SQL file in
   production. The SQL Editor does not provide a reliable project slug to
   validate automatically.
2. Copy the disposable User A and User B UUIDs from **Authentication →
   Users**. In `rls_api_fixtures.sql`, replace the `NULL` seller placeholder
   with User B's quoted UUID and the `NULL` buyer placeholder with User A's
   quoted UUID. In `rls_api_fixtures_cleanup.sql`, replace both `NULL` UUID
   placeholders with their respective quoted UUIDs. Do not copy credentials
   or API keys into these SQL files.
3. Run `rls_api_fixtures.sql` in the trusted SQL Editor for echovault-dev.
   Do not wrap it in `ROLLBACK`: a successful `DO` statement persists the
   fixtures for the later API requests. It verifies User A and User B already
   have standard profiles/roles and does not change roles or subscriptions.
4. The setup creates three public test recordings, one original version per
   recording, and published/draft/archived listings. Storage and preview paths
   are placeholder strings only; it uploads no files and needs no Storage
   buckets. The listing markers begin with
   `<User-B-UUID>/rls-api-test-fixture-`.
5. Run the API test command below. It authenticates User A and B separately
   and checks published visibility, buyer denial for draft/archive listings,
   and direct license-insert denial against these exact fixtures.
6. When finished, confirm echovault-dev is still selected, put the same User B
   and User A UUIDs into `rls_api_fixtures_cleanup.sql`, and run it in the
   trusted SQL Editor. Cleanup removes reports/licenses first, then listings,
   versions, and recordings to respect the `ON DELETE RESTRICT` foreign keys.
   It also removes the API script's marked private User A recording and any
   version created under it. It leaves profiles, roles, and subscriptions
   untouched.

The API script may also leave its own private recording fixture. Ordinary
clients cannot delete it; the cleanup SQL identifies it by User A UUID, the
`RLS API verification` title prefix, exact fixture description, and private
visibility.

Run the real-session API test from the repository root in PowerShell:

```powershell
node --env-file=.\supabase\tests\.env.rls-test.local .\scripts\verify-rls-api.mjs
```

The script requires the interactive `echovault-dev` confirmation before
network requests. A missing fixture is reported as `SKIP`, not `PASS`.
With standard User A/User B accounts, User A on the free plan, and all three
SQL fixtures present, the expected result is 15 passed, 0 failed, 0 skipped.

## Frontend column contract

Use explicit Supabase `.select('...')` column lists; do not use `.select('*')`
for these tables:

| Resource | Select only |
|---|---|
| `profiles` | `id,display_name` |
| `user_roles` | `user_id,role` |
| `subscriptions` | `user_id,plan,expires_at,updated_at` |
| `voice_recordings` | `id,owner_id,title,description,category,visibility,created_at,updated_at` |
| `voice_versions` | `id,recording_id,effect_type,effect_settings,storage_path,duration_seconds,mime_type,file_size_bytes,created_at` (only rows allowed by RLS) |
| `listings` | `id,version_id,status,sale_price_cents,rental_price_cents,rental_days,currency,preview_path,created_at` |
| `licenses` | `id,listing_id,buyer_id,license_type,price_cents,created_at,expires_at` |
| `reports` | `id,listing_id,reporter_id,reason,status,created_at,resolved_at` |
| `marketplace_listing_summaries` view | `listing_id,version_id,recording_id,title,description,category,seller_id,seller_display_name,effect_type,duration_seconds,mime_type,sale_price_cents,rental_price_cents,rental_days,currency,preview_path,created_at` |

No Supabase data-service queries currently exist in the frontend. The
`voice_versions.storage_path` column is intentionally granted only alongside
the row policy that limits results to the owner or a valid license holder.
The marketplace view omits it.

The marketplace view explicitly uses owner permissions
(`security_invoker = false`) because invoker permissions would apply the
private `voice_versions` row policy and hide published versions from
unlicensed buyers. The view bypasses underlying table RLS, so its fixed
published/public/preview predicates, allowlisted output columns,
`security_barrier`, and authenticated-only SELECT grant are part of its
security boundary. Review every future view-column or predicate change as a
privileged data disclosure change. The repository's `supabase/config.toml`
exposes only `public` and `graphql_public`; verify the hosted Data API excludes
`private` as well.

## Allow/deny matrix

| Area | Expected allowed | Expected denied |
|---|---|---|
| Profiles | Signed-in user reads/updates own display name; signed-in users see only `id` and `display_name` for an author with a published public listing; admin reads all profile rows with those same columns | Anonymous access; user reads a non-author's private profile; client changes `id`, inserts, or deletes profiles |
| User roles | User reads own role; admin reads roles | User reads another role or directly inserts, updates, or deletes a role, including self-promotion |
| Subscriptions | User reads own plan/expiry; admin reads subscriptions | User reads another subscription or directly inserts, updates, or deletes a plan/expiry |
| Voice recordings | User creates and updates own metadata; signed-in users read public recordings; valid license holder can read the related private recording | Anonymous access; User A inserts as User B or reads/updates/deletes User B's private recording |
| Voice versions | Owner inserts original; active Premium owner inserts processed version; valid license holder reads the licensed version | Free/expired Premium inserts processed version; duplicate original or storage path; another user reads private `storage_path`; any user updates/deletes a version |
| Listings | Owner creates and edits own listing; authenticated users read published listings backed by public recordings; owner sees own draft/archive; admin reads all | User lists another owner's version, publishes a private source/no preview, changes `version_id`, edits another seller's listing, or deletes a listing; ordinary buyer reads draft/archive |
| Licenses | Buyer reads own license; admin reads all | Seller reads buyer-specific license rows; direct client insert, update, or delete, even for an authenticated user |
| Reports | User submits a report as self with `open` status; user reads own report; admin reads and updates report status/resolution | User impersonates another reporter, submits as resolved, reads another report, updates/deletes reports, or performs admin changes |
| Audio path helper | Owner and holder of a matching unexpired license are authorized for the exact version path | No license just because a listing is published; expired rental, different version path, unrelated user, and admin without ownership/license |

## Storage follow-up boundary

This migration does not create Storage policies. Before audio upload/download
is enabled, add separate policies for the private `voice-files` bucket that
allow inserts only under the caller's UUID folder and allow reads only for the
owner or a caller with a valid license for the exact version path, using
database time for rental expiry. Do not allow general `SELECT` on
`storage.objects` for that bucket. Keep public previews in a separate bucket
and never use it for full recordings.
