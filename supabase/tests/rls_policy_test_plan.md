# EchoVault RLS Policy Test Plan

Run `rls_policies.sql` only against a disposable local Supabase database or a
development project, using a trusted database-owner connection. The script
switches to the actual `authenticated` and `anon` database roles before each
test block, sets test JWT claims in that trusted session, and rolls back all
fixture changes. This is a database-side test harness, not a way for browser
clients to choose their JWT identity. Do not run it against production.
The Prompt 09 assertions require
`20261122180000_private_audio_storage.sql` to be applied first.

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
Its setup statements require a trusted RLS-bypassing database-owner role;
the later `SET LOCAL ROLE authenticated`/`anon` blocks are the actual SQL RLS
checks.

Run from the repository root with a local/dev database URL:

```powershell
psql "$env:SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_policies.sql
```

The script fails immediately if any account or bootstrap row is missing, if
the current database role cannot create fixtures, or if an allowed/denied
assertion has the wrong result.

The regression assertions specifically use `INSERT ... RETURNING id` for
recordings and Premium-edited versions. With Prompt 09 applied, they also
verify that fabricated original metadata without an uploaded object is denied
and that a hidden cross-owner reference is not considered unreferenced. The
real-session API test verifies the original-recording RPC returns both created
row IDs. Before changing roles, the SQL setup checks authenticated Storage
schema/table SELECT access, metadata RPC INSERT/RETURNING column grants, and
the helper/RPC EXECUTE grants (authenticated allowed, anonymous denied). The
SQL assertions also verify the active role, JWT `sub` setting, and `auth.uid()`
for User A before testing.

## Real-session API fixtures (echovault-dev only)

The JavaScript API test uses the disposable standard User B account as the
fixture seller and User A as the buyer. It expects one marker-specific
published listing, one draft, and one archived listing. To prepare them:
The API credentials in `.env.rls-test.local` may identify a dedicated pair
different from the seven email-named accounts used by `rls_policies.sql`.
The fixed buyer/seller UUIDs in the API fixture setup and cleanup files must
match the API Auth sessions; the SQL RLS suite resolves its own users by email.

1. In Supabase Dashboard, select **echovault-dev** and verify its project
   reference matches the project reference in
   `supabase/tests/.env.rls-test.local`. Never run either fixture SQL file in
   production. The SQL Editor does not provide a reliable project slug to
   validate automatically.
2. Verify the User A and User B UUIDs in
   `rls_api_fixtures.sql` and `rls_api_fixtures_cleanup.sql` match the
   disposable accounts shown under **Authentication → Users**. Edit only
   those test UUID constants if needed. Do not copy credentials or API keys
   into these SQL files.
3. Run `rls_api_fixtures.sql` in the trusted SQL Editor for echovault-dev.
   Do not wrap it in `ROLLBACK`: a successful `DO` statement persists the
   fixtures for the later API requests. It verifies User A and User B already
   have standard profiles/roles and does not change roles or subscriptions.
   This is administrative marketplace metadata setup: its `.placeholder`
   voice paths intentionally have no Storage objects and are not used to test
   audio access. The fixture script refuses to run as a normal authenticated
   or anonymous role.
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
   trusted SQL Editor. The script checks marked owners/titles/paths, removes
   only the fixed listings, versions, and recordings. It aborts rather than
   deleting any reports or licenses found on those fixtures. The script also
   removes the API script's marked private User A recordings and their versions,
   while leaving profiles, roles, subscriptions, reports, and licenses
   untouched.

The API script may leave a marked original recording and its private Storage
object. Ordinary clients cannot delete a referenced original. The cleanup SQL
identifies the recording by User A UUID, the `RLS Storage API verification`
title prefix, exact fixture description, and private visibility; before
deleting metadata, it prints the exact UUID-scoped object paths that become
unreferenced. Only after the SQL cleanup succeeds, remove those printed paths
through User A's authenticated Storage API. The API test also prints retained
or unresolved upload paths so partial failures can be reconciled safely; each
attempted path is logged before its upload request.
Never use the cleanup process against production.

Run the real-session API test from the repository root in PowerShell:

```powershell
node --env-file=.\supabase\tests\.env.rls-test.local .\scripts\verify-rls-api.mjs --confirm-echovault-dev
```

The script requires the interactive `echovault-dev` confirmation before
network requests. In a non-interactive runner, the explicit
`--confirm-echovault-dev` flag is accepted only after both configured URLs
match the verified echovault-dev project reference. A missing fixture is
reported as `SKIP`, not `PASS`.
With the new private-audio migration applied to echovault-dev, standard
User A/User B accounts, User A on the free plan, and all three SQL fixtures
present, the expected result is 32 passed, 0 failed, 0 skipped: 31 required
API checks plus the separate successful sign-in check.

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

Prompt 09 adds explicit-column recording and version queries in the recording
and library services. The `voice_versions.storage_path` column is intentionally
granted only alongside the row policy that limits results to the owner or a
valid license holder. The marketplace view omits it.

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
| Voice versions | Owner inserts an original only when its private object, owner-scoped path, MIME/extension, size, and duration validate; active Premium owner inserts processed version; valid license holder reads the licensed version | Direct original metadata without a matching object; Free/expired Premium inserts processed version; duplicate original or storage path; another user reads private `storage_path`; any user updates/deletes a version |
| Listings | Owner creates and edits own listing; authenticated users read published listings backed by public recordings; owner sees own draft/archive; admin reads all | User lists another owner's version, publishes a private source/no preview, changes `version_id`, edits another seller's listing, or deletes a listing; ordinary buyer reads draft/archive |
| Licenses | Buyer reads own license; admin reads all | Seller reads buyer-specific license rows; direct client insert, update, or delete, even for an authenticated user |
| Reports | User submits a report as self with `open` status; user reads own report; admin reads and updates report status/resolution | User impersonates another reporter, submits as resolved, reads another report, updates/deletes reports, or performs admin changes |
| Audio path helper | Owner and holder of a matching unexpired license are authorized for the exact version path | No license just because a listing is published; expired rental, different version path, unrelated user, and admin without ownership/license |

## Private original-audio Storage tests

The forward-only `20261122180000_private_audio_storage.sql` migration creates
the private `voice-files` bucket, per-operation RLS policies, and the
invoker-rights `create_original_voice_recording` RPC. It does not change
ownership or RLS on the Supabase-managed `storage.objects` table. If
`voice-files` already exists, the migration preserves it and proceeds only
when its name, private setting, 20 MiB limit, and MIME allowlist match exactly;
otherwise it raises an error for manual review instead of overwriting settings.

The INSERT policy on `voice_versions` independently validates that every
authenticated original points to an existing object under the caller's UUID,
with a matching MIME, extension, size, and duration. This prevents a direct
table insert from bypassing the RPC's object checks. The partial unique index
still enforces one original per recording. A `SECURITY DEFINER` helper with a
pinned empty search path checks references without being affected by
`voice_versions` RLS; it returns only whether the authenticated user's own
path is unreferenced. The SQL RLS test includes a hidden cross-owner reference
fixture to verify it is not misclassified as unreferenced.

The administrative SQL fixtures in `rls_api_fixtures.sql` and the setup
section of `rls_policies.sql` intentionally use placeholder paths for
marketplace/RLS metadata only. They are inserted by a trusted database role
that bypasses RLS, create no `storage.objects` rows, and do not test microphone
uploads or the application RPC. The API integration test performs real object
uploads through `clientA.storage.from('voice-files').upload(...)` with an
authenticated session before calling the RPC.

The authenticated API test covers owner upload/RPC/list/download; User B and
anonymous denial; path claiming, overwrite, and deletion attempts; unsupported
MIME and MIME/extension mismatch rejection; oversized uploads; direct original
insertion without an object; duplicate and repeated save attempts; RPC
uploaded-object MIME/size mismatch; metadata-failure cleanup; referenced-file
immutability; and removal of an unreferenced owned object. The focused local
validation test also checks all supported MIME-to-extension mappings,
codec-parameter normalization, unsupported MIME, file-size limits, and
duration validation. Storage reads are limited to the caller's own folder or
an exact path authorized by `private.can_access_audio_path`; no public
full-audio URL is used.

Do not run the real-session test until the migration is reviewed and applied
to echovault-dev. The test intentionally leaves the successful referenced
fixture for trusted cleanup; it does not clean referenced audio through an
ordinary client.
