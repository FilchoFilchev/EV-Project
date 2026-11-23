# EchoVault deployment readiness

**Production URL: PENDING.** This guide prepares a reviewable Netlify build and
later release procedure. It does not claim a deployment, migration, Auth setting
change or successful live test. Prompt 18's current execution stops locally for
review without commit, push, deployment or remote application-data writes.

The only permitted cloud development target is **echovault-dev**, project
reference **`zysyghbbbesatbehravb`** and API origin
`https://zysyghbbbesatbehravb.supabase.co`. Never select or modify the separate
primary **echovault** project. A CLI link, a dashboard project and a built browser
bundle can point at different places; verify each independently before future
authorized operations.

## Checked-in hosting configuration

| Setting | Value/source |
|---|---|
| Build command | `npm run build` in `netlify.toml` |
| Publish directory | `dist` |
| Node | `22` major in `netlify.toml`; use current 22.x maintenance patches |
| Dependency installation | Reproducible lockfile; use `npm ci` locally |
| Vite inputs | Nine top-level HTML inputs in `vite.config.js` |
| Output | Explicit `build.outDir: 'dist'` |
| Routing | Real `.html` URLs; no `/* /index.html 200` SPA rewrite |

All backend behavior is Supabase-hosted. A static deploy does not run SQL
migrations, create buckets/accounts or change Auth settings. Existing migration
files are immutable history; any newly required database change must be a reviewed
forward-only migration. No new Prompt 18 database migration is required by the
documentation/hosting/dashboard polish.

## Local readiness before release

1. Review the complete diff, pending database history and target assumptions.
   Keep `.env.local` ignored. Use Node 22.12+ and `npm ci`.
2. Configure the browser-safe URL/publishable key for an isolated local stack or
   verified development project, without displaying existing env values. Rebuild
   after any environment change; values are embedded at Vite build time.
3. Run `npm test`, `npm run test:prompt18`, `npm run build`,
   `npm run test:build`, `npm run check:syntax` and `git diff --check`.
   Record actual exit codes/output. The offline source/mocked suites do not
   validate remote SQL or browser behavior.
4. Serve `dist` with `npm run preview` and check all nine direct page URLs/reloads
   and asset paths. Test desktop/mobile/keyboard and audio using disposable local
   fixtures per [the acceptance checklist](test-checklist.md).
5. With a supported local Docker/Supabase environment, test migrations from scratch
   only in a disposable local database. `npx supabase start` starts that stack;
   a deliberate `npx supabase db reset --local` recreates it and destroys its local
   fixtures. Never use a remote reset or apply/push commands during this local
   execution. The local config disables the absent seed file.
6. Execute reviewed focused SQL/RLS suites only against the isolated local host.
   Also test real Storage delivery with actual fixture audio; SQL object metadata
   alone does not prove playable bytes. Record missing runtimes as SKIP.

## Build-time environment scope

For a later authorized Netlify release, configure these two values in the
appropriate site's **build** environment and intended deploy context:

- `VITE_SUPABASE_URL`: the verified development API URL above for this project.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: its browser-safe publishable key.

Vite includes `VITE_*` values in public JavaScript. Never set service-role/secret
keys, JWT signing secrets, database passwords, payment keys or demo-account
passwords under these names or anywhere client-accessible. The client rejects
legacy JWT-format keys; use a compatible publishable key. Changing Netlify
runtime/function-only environment scope will not change an already built static
bundle: rebuild with the correct build/context values.

Check Production, Deploy Preview and branch contexts independently before any
authorized build. Do not accidentally inherit credentials/configuration for the
primary project. Choose only the approved context/site; this guide does not
authorize publishing to an existing site or creating a new one.

## Supabase Auth URLs and email confirmation

Inspect `authService.signUp`, `supabaseClient.js` and the email template before
changing settings. The current app sends no `emailRedirectTo` override and has no
custom `/auth/callback` page. Its Supabase client enables session detection in the
URL; the confirmation template uses `{{ .ConfirmationURL }}`. Thus signup
confirmation follows the project's configured **Site URL**, normally the app's
root, where the session-aware navbar permits Dashboard navigation. With an
immediate session, the registration page redirects to `/dashboard.html` itself.

For an authorized hosted configuration:

1. Obtain the real HTTPS application origin from the reviewed Netlify deployment.
   Keep **Site URL = that exact origin/root URL**, such as the actual origin plus
   `/`; no fabricated domain is supplied here. Because signup currently has no
   per-request override, confirm the Site URL belongs to the intended app
   environment before testing registration.
2. Add that exact root URL to permitted redirect URLs. Add only other actual
   destinations intentionally used by the app; do not invent a callback route or
   broad untrusted-domain wildcard. A preview domain needs its own deliberate
   review/allowed URL if it will handle confirmation.
3. Keep required local dev/preview URLs available only as appropriate to the
   development environment. Checked-in **local** config has Site URL
   `http://localhost:5173` and redirect patterns for `localhost`/`127.0.0.1` on
   ports 5173 and 4173. These local settings do not configure the cloud project.
4. Local email confirmations default to disabled. If testing confirmation, enable
   it deliberately only in the isolated local fixture environment and inspect
   the local email service. Hosted behavior follows that project's actual Auth
   configuration and SMTP/rate limits. Do not change cloud email settings as part
   of the current local execution.
5. After authorization and with NEW disposable dev personas only, test a real
   confirmation link, correct resulting origin/session, login/logout, reload and
   protected return URLs. Mark the result SKIP until performed. The
   [email template source](email-templates/confirm-signup.html) is not evidence
   that it was installed remotely.

## Later release authorization gates

Finish local review and verification first. The project owner must then authorize
any desired commit/push, remote migration, site deployment, cloud Auth setting
change and new demo-account preparation; authorization for one does not imply all
the others. Do not modify existing real roles/subscriptions or shared content.

Before any approved migration, reverify `echovault-dev`/`zysyghbbbesatbehravb`,
inspect the real remote migration state, review data compatibility and take the
appropriate recovery precautions. A Git commit or static build is not evidence
that a pending migration was applied. Never rewrite earlier applied migrations
or use destructive cleanup. Do not execute disabled admin bootstrap automatically;
follow [the demo-account guide](demo-accounts.md) for a new disposable target only.

Before any approved deploy, select the reviewed Netlify site/context, inspect
build-time variables, and review the final output/security checks. Publish only
after that concrete build is approved. Record the actual live URL and deploy
identifier privately/as appropriate; add the real live URL to README only after
verification. This document contains no automatic remote deployment command.

## Production smoke checks after authorized release

For the actual HTTPS origin, open and reload every entry directly:

| URL | Expected behavior |
|---|---|
| `/` and `/index.html` | Landing loads with correct assets and session navigation |
| `/register.html` | Signup form/validation; write flow only with approved new demo persona |
| `/login.html` | Sign-in form; verified session redirects safely |
| `/dashboard.html` | Guest login redirect; own counts/recent/DB-checked plan for signed-in user |
| `/studio.html` | Guest redirect; audio controls and real microphone on HTTPS |
| `/marketplace.html` | Guest redirect; permitted published metadata and public previews |
| `/voice-details.html?id=<actual-demo-uuid>` | Correct listing/preview/terms; invalid or unavailable ID gives clear feedback |
| `/my-library.html` | Guest redirect; own library/listings and valid licensed audio only |
| `/admin.html` | Guest redirects, ordinary user forbidden, legitimate admin panel permitted |

Verify no 404/broken assets on direct reload, no SPA fallback hiding missing
pages, mobile menu/focus, sensible loading/empty/error states and no private full
audio URLs in Marketplace HTML. Test actual authentication/confirmation and
authorized audio separately from static HTTP checks. Restrict report/checkout/
save/moderation/plan writes to separately approved NEW disposable development
fixtures. Capture genuine screenshots for at least five pages and record any
FAIL/SKIP. **Live URL, credentials, screenshots and production smoke evidence
remain PENDING until supplied and observed.**
