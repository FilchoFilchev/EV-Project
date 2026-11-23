# Prompt 18 — local implementation and validation

Date: November 23, 2026 (Europe/Sofia). Scope stops locally for review.

## Exact requirement and baseline

The source of truth is `EchoVault_Copilot_Prompts.md`, **Prompt 18 — Polish,
Deployment and Docs**:

> Perform a final audit against the SoftUni Capstone rubric: 9 responsive pages, ≥8 tables, admin, Supabase Auth/Storage/RLS, upload/download, migrations in repo, 15+ authentic commits across 3+ calendar days, Netlify production build, README architecture + ER diagram + setup + demo accounts. Fix issues one at a time; do not fabricate test results or Git history. Produce a 5-minute demo script and test checklist.

Related acceptance: Blueprint sections 4, 11 phase G, 12 (T01–T20), 13–16.
The user's execution constraints prohibit deployment, remote migrations/data
changes, commits and pushes, so release evidence stays pending where unavailable.

Before edits the working tree was clean on `main`. `HEAD`, `origin/main` and the
actual GitHub `refs/heads/main` all matched
`17979ba2ef89166971c42a0172683e1ae66c7cc8` (Prompt 17, `Security`). GitHub was
checked read-only with `git ls-remote`. No history was fabricated or rewritten.
The interrupted execution's three valid documentation drafts were preserved.

## Implemented fixes

- Replaced the placeholder dashboard with verified-user-scoped exact counts for
  recordings, edited versions, catalog-available own listings and acquired
  licenses. Counts do not depend on the REST row cap. The listing count requires
  published status, public source metadata and a preview. Licenses include past
  rentals, as the UI explicitly states. Recent recordings are limited to five.
- Reused `has_active_premium()` via the existing subscription service for DB-time
  plan status. Added loading, empty, error, refresh, safe text rendering,
  duplicate-refresh suppression and stale/account-change response protection.
- Completed the documented landing information/plans and short prototype
  Terms/Privacy sections. Shared footer links now reach those sections. Added
  shared keyboard skip navigation, a focusable main landmark, anchor offset and
  long-text wrapping without replacing the established design.
- Allowed HTTP Supabase URLs only on exact loopback hosts; retained remote HTTPS
  requirements and privileged-key rejection, and rejected URL credentials.
- Aligned **local-only** Supabase Auth URLs to Vite dev/preview ports and disabled
  the nonexistent seed file. No applied SQL migration changed.
- Added `netlify.toml`: `npm run build`, publish `dist`, Node major `22` (current
  22.x maintenance patches). Vite uses nine top-level inputs, explicit `dist` and
  `appType: 'mpa'`. No SPA fallback or backend hosting change was introduced.
- Completed README, architecture/ER, isolated local setup, demo-account handover,
  later deployment procedure, a timed five-minute demo and T01–T20 checklist.
  Missing credentials/live URL/screenshots are explicitly pending.
- Added an explicit safe offline test allowlist, focused Prompt 18 tests,
  production HTTP/asset verification and a syntax-only script.

## Rubric audit

| Requirement | Local evidence | Limit |
|---|---|---|
| Nine responsive pages | Nine distinct modules/HTML inputs, Bootstrap viewport/layout source, production output/HTTP checks | Actual desktop/mobile/keyboard rendering SKIP |
| At least eight tables | Eight application tables and RLS declarations in versioned migrations; ER reflects actual fields | PostgreSQL execution/schema parity SKIP |
| Admin, Auth, Storage, RLS, upload/download | Existing implementation preserved; relevant mocked services/UI/security contracts pass | Real Auth/audio/Storage/API execution SKIP |
| Migrations in repository | Existing versioned files preserved; no migration diff | No remote application or parity certification |
| Authentic Git history | 25 existing commits across four Europe/Sofia calendar dates | No new commits/pushes performed |
| Netlify production build | Vite build, nine pages, local production HTTP/assets; TOML property names/types reviewed against Netlify's schema | Actual Netlify build/CDN/release SKIP |
| README architecture/ER/setup/demo accounts | README and linked guides complete; accounts have honest pending status/private handover instructions | Actual assessor logins not supplied/verified |
| Five-minute script/checklist | Timed demo totals 5:00; checklist maps T01–T20 | Rehearsal/runtime execution pending |
| Screenshots (Blueprint section 14) | Capture instructions/evidence list prepared | Actual screenshots from five pages SKIP |

## Observed validation

Executed with Node `v26.13.1`, npm `12.2.3`, installed Vite `8.3.8` and existing
dependencies. No dependency installation or lockfile change was necessary.
Netlify's configured Node 22.x runtime was not separately executed.

| Command/check | Result | Observed evidence |
|---|---|---|
| `npm.cmd test` | **PASS** | 32/32 offline suites, including audio/effects/export, edited save, listings/previews/search, Demo Checkout, licensed audio, reports/admin and focused dashboard/config/contracts |
| `npm.cmd run test:prompt18` | **PASS** | 3/3 focused suites: dashboard, browser config and final repository/docs/hosting contracts |
| `npm.cmd run build` | **PASS** | 101 modules transformed; all nine HTML entries emitted in `dist` |
| `npm.cmd run test:build` | **PASS** | Nine production HTML files, 24 referenced assets, 18 direct/query HTTP page loads; missing page returns 404 on a temporary loopback Vite preview |
| `npm.cmd run check:syntax` | **PASS** | 83 JavaScript/module files parsed, including scripts without executing their operational code |
| `git diff --check` | **PASS** | No whitespace errors; Git's LF/CRLF notices are informational |
| Build environment target | **PASS** | Locally checked approved development URL and browser-safe publishable-key format without printing their values |
| Browser-source/asset secret-pattern scan and independent diff review | **PASS** | 50 text source/assets and 18 production JavaScript chunks scanned; no secret-shaped key/private-key values found; no blocking security or unrelated edit found |
| PostgreSQL/SQL/RLS/REST/Storage HTTP/concurrency | **SKIP** | Docker and `psql` unavailable; source contracts/mocks do not establish runtime authorization |
| Real browser/desktop/mobile/audio | **SKIP** | Browser access host unavailable. Native Chrome fallback stopped because Computer Use could not determine the browser URL confidently enough to enforce policy. No page rendering/audio result claimed |
| Netlify deployment, production URL/reload/Auth | **SKIP** | Explicitly prohibited; no deployment attempted |
| Demo-account logins and five-page screenshots | **SKIP** | No verified credentials supplied; browser validation unavailable; no roles/subscriptions/accounts modified |

Final **FAIL: none** among executed local checks. Intermediate validation caught
an unfinished documentation dependency and two overly broad assumptions in the
new build verifier (the details page intentionally shares the Marketplace
navigation marker; navigation links and an optional dependency string are not
static asset files). The documentation was completed and the verifier corrected;
final reruns passed. These were not presented as application/runtime successes.

The test runner is an explicit offline allowlist. It does not execute the old
live attack or cleanup entry points. Build HTTP tests request only their own
`127.0.0.1` preview, not Supabase. Syntax checks parse operational scripts without
running them. The separately started preview used for the blocked UI attempt is
stopped after validation.

## Security and database review

No new migration is required. Previous migrations, data grants, RLS policies,
checkout, audio authorization and moderation SQL remain unchanged. No remote
database/application data, Storage objects, roles or subscriptions were modified.
The primary `echovault` project was never used. The approved build target remains
`echovault-dev` (`zysyghbbbesatbehravb`). No service-role key was added or exposed.

Dashboard authorization still depends on server-side RLS, with additional
verified-caller ownership filters and minimal metadata in the client. Admin role
and Premium subscription remain independent. Reporting, checkout, license
expiry, archive preservation and private audio service regression tests passed
with mocks/source contracts; their SQL runtime checks remain pending.

Existing limits remain documented: SQL cannot independently prove decoded media
content/preview derivation; public previews remain public after archive; rentals
cannot erase downloaded copies. A trusted media pipeline is future production
work, not an added Prompt 18 feature. Local legacy anonymous JWT keys remain
rejected by the existing browser-key rule; a compatible publishable key is needed
for local browser fixtures. These are not new security regressions.

## Files changed

Modified:

- `README.md`
- `dashboard.html`
- `index.html`
- `package.json`
- `scripts/test-admin-navigation.mjs`
- `src/css/main.css`
- `src/js/components/footer.js`
- `src/js/components/navbar.js`
- `src/js/config/supabaseClient.js`
- `src/js/pages/dashboardPage.js`
- `supabase/config.toml`
- `vite.config.js`

Added:

- `docs/architecture.md`
- `docs/demo-accounts.md`
- `docs/demo-script.md`
- `docs/deployment.md`
- `docs/er-diagram.md`
- `docs/prompt18-validation.md`
- `docs/test-checklist.md`
- `netlify.toml`
- `scripts/check-syntax.mjs`
- `scripts/run-local-tests.mjs`
- `scripts/test-dashboard.mjs`
- `scripts/test-production-build.mjs`
- `scripts/test-prompt18.mjs`
- `scripts/test-supabase-config.mjs`
- `src/js/components/dashboardOverview.js`
- `src/js/services/dashboardService.js`

`dist` is generated/ignored. No migration, dependency lockfile or environment file
was changed. No commit, push, deployment or subsequent prompt was performed.

## Required review and browser checks

Use [the detailed checklist](test-checklist.md). Minimum manual follow-up:

1. Run the local app/preview and inspect all nine pages at desktop and 375px/320px
   widths, keyboard-only and 200% zoom. Verify skip link/focus, menu, direct
   reload/assets and landing Terms/Privacy links; check guest redirects.
2. With permitted existing dev sessions, read the dashboard and compare own
   counts/recent/plan to the account's actual library/listings/licenses; refresh,
   offline/retry and account switching must not expose stale data.
3. On disposable **local** fixtures, test registration/defaults, recording/upload,
   Premium effects/WAV, publication/preview, Demo Buy/Rent/licensed download,
   expired rentals, cross-user denial and admin/report/role/plan denial cases.
   Do not mutate shared development data to perform these checks.
4. Capture genuine screenshots of at least five screens and verify demo-only
   account logins for the private handover. Rehearse [the script](demo-script.md).
5. Review this diff and evidence gaps before authorizing commit/push. Deployment,
   any remote migration/Auth change or new remote demo-data preparation each
   remains outside the current execution. After an authorized release, verify the
   actual live URL and update README/submission evidence.

Local implementation is ready for review; complete rubric/submission acceptance
still depends on the explicitly skipped runtime and release evidence.
