# EchoVault final test checklist

This is a repeatable acceptance checklist for Prompt 18 and Blueprint T01–T20.
It does not record execution results. Use **PASS** only after observing the
expected behavior; use **FAIL** with the actual error; use **SKIP** with its
reason when a runtime, fixture or authorization is unavailable. Record date,
browser/viewport, target, persona and evidence alongside each result. Automated
source/mocked checks do not establish database, browser or production acceptance.

## Safe execution boundaries

- **Offline/local:** source tests, build, syntax, Git history and local static
  HTTP checks may run without contacting Supabase. Run the commands below.
- **Existing development data, read-only:** first verify the app URL/config is
  for `echovault-dev`, project reference `zysyghbbbesatbehravb`. With a permitted
  existing session, inspect only already available metadata, existing public
  previews and the current account's already authorized audio. Admin list reads
  require an existing legitimate admin session. Do not create accounts, save
  audio, publish, checkout, report, archive/restore, resolve, bootstrap roles or
  assign plans. Do not change an existing rental's expiry to simulate time.
- **Mutation and negative API tests:** use an isolated local Supabase and NEW
  disposable personas/objects only. Confirm the actual browser Supabase URL and
  SQL host are `localhost`/`127.0.0.1` before every write test. A development CLI
  project link does not prove the running browser uses that project. Preserve
  shared data and do not run old live API attack or cleanup suites.
- **Production:** deployment and remote migrations are outside this execution.
  Netlify build readiness is distinct from a deployed, verified live URL. Never
  touch the separate primary `echovault` project.

## Reproduce local automated validation

After dependencies are installed, run from the repository root in PowerShell:

```powershell
npm.cmd test
npm.cmd run test:prompt18
npm.cmd run build
npm.cmd run test:build
npm.cmd run check:syntax
git diff --check
```

`npm test` runs the safe offline suite. `test:prompt18` checks final repository
contracts; `test:build` requires a current production build and checks its local
output. These commands do not deploy, apply SQL or create remote fixtures. Record
their actual exit codes and output in the validation report rather than marking
the manual scenarios below passed from these results alone.

## Blueprint acceptance matrix

All runtime statuses below are **PENDING** until someone executes and records
them. Where no runtime is available, report **SKIP** rather than PASS.

| ID | Scenario and expected result | Where to verify |
|---|---|---|
| T01 | As guest open `studio.html`: redirect to Login; protected content is not briefly revealed. Also check the other protected pages. | Local browser without a session; no application writes |
| T02 | Register a disposable account and confirm email if required. Verify one profile, role `user`, plan `free`; forged signup metadata cannot grant authority. | Isolated local Auth/database only |
| T03 | Save a new consented original. Verify private `voice-files/<owner_uuid>/…`, recording and exactly one original version; reload My Library. Empty/invalid/oversized audio fails clearly. | Isolated local browser/Storage/database |
| T04 | Unrelated User B queries User A's private recording/version using known fixture IDs: no unauthorized rows. Own data remains readable. | Isolated local SQL/API; no remote attack scripts |
| T05 | User B guesses User A's private audio path: download denied. Public full-audio URL also fails. Owner's authorized download works. | Isolated local Storage/API with actual audio bytes |
| T06 | Free account submits a forged edited-version insert; server rejects it even if UI controls are bypassed. | Isolated local SQL/API |
| T07 | Active Premium saves a real Muffle WAV: new private object/version, correct effect settings, original unchanged. Audibly compare Original/Muffle/Distortion/Echo and Reset. | Isolated local browser/audio/Storage/database |
| T08 | Publish a permitted owned version with a separate 5–8 second preview and rights/public metadata confirmations. Preview plays, full file remains private. Invalid prices, ownership and preview metadata fail. | Isolated local mutation flow; existing published previews can be viewed read-only in verified dev |
| T09 | Attempt client price/buyer/seller/expiry manipulation. Required RPC accepts only listing/type; stored receipt uses DB offer/identity/time. Own listing and unavailable offers are rejected; rapid/repeated requests do not create duplicate permanent buys. | Isolated local SQL/API/checkout |
| T10 | Ordinary/Premium user attempts role escalation through metadata/direct API: denied; role remains `user`. | Isolated local SQL/API |
| T11 | Ordinary user attempts Premium/expiry assignment directly: denied. Admin role alone does not imply Premium. | Isolated local SQL/API |
| T12 | Different buyer completes Demo Buy and sees its own receipt; exact licensed full audio plays/downloads. Checkout explicitly says no real money is charged. Other users cannot use that receipt. | Isolated local browser/API with actual audio |
| T13 | Use a disposable expired-rental fixture. New playback/download request is denied using DB time, regardless of browser clock. Valid rent allows download; previously downloaded copies cannot be revoked. | Isolated local SQL plus actual Storage HTTP delivery |
| T14 | Archive a new listing with existing disposable buy/rent licenses. It leaves Marketplace/new checkout; existing permanent buy/unexpired rent still resolves the same exact audio. No objects/receipts are removed. | Isolated local browser/SQL/API |
| T15 | Ordinary and anonymous callers invoke every admin read/action RPC directly: denied. Direct report writes, report resolution, plan updates and unrelated report reads are unavailable. | Isolated local SQL/API; page hiding alone is insufficient |
| T16 | User reports new listing; duplicate pair is rejected. Local admin reviews tabs, resolves once, archives/restores only the new offer. Resolution timestamp/evidence persist; draft/private restore fails. | Isolated local browser/SQL/API |
| T17 | All nine pages pass the viewport/keyboard matrix below, including tab panels, menus and loading/empty/error states. | Local browser; protected content uses isolated local fixtures |
| T18 | Build and directly load/reload all nine `.html` URLs and a valid listing query; assets resolve without 404. Repeat against actual Netlify production only after authorized deployment. Unknown URLs must not silently return an SPA shell. | Local production preview first; Netlify part PENDING |
| T19 | Inspect genuine `git log --format="%h %aI %s"`: at least 15 meaningful commits across at least 3 calendar days. Keep dates/history authentic; do not backdate or fabricate commits. | Local Git history; pushed branch parity checked separately |
| T20 | A real public production URL and purpose-created demo user/admin credentials work after authorized release. Record actual target and test date. | PENDING: live URL/credential handover are not supplied by this checklist |

Focused rollback SQL suites are in `supabase/tests/`, including
`prompt12_edited_versions.sql`, `prompt13_listings_previews.sql`,
`prompt15_demo_checkout.sql`, `prompt16_licensed_audio.sql` and
`prompt17_reports_moderation.sql`. Review their preconditions and run only against
an isolated local database. Metadata fixtures do not prove actual audio bytes or
HTTP delivery; the browser/Storage checks remain separate.

## Nine-page desktop/mobile and accessibility matrix

For **each** row test desktop (approximately 1440×900), mobile (375×812 and
320px width), direct URL/reload and keyboard-only navigation. Check no horizontal
page overflow, clipped controls or unreadable text; clear focus; useful labels;
one main heading; accessible status/error feedback; and the mobile menu. Test at
200% zoom and with reduced motion enabled. Record actual results per viewport.

| Page | Additional checks | Status |
|---|---|---|
| `index.html` | Get started leads to Register; Login/Dashboard links reflect the session; Terms/Privacy readable. | PENDING |
| `register.html` | Labels, password/confirmation/acknowledgement errors, loading and email-confirmation response; no role/plan inputs. Signup only on local fixtures. | PENDING |
| `login.html` | Password field and submit usable; errors announced; only permitted internal redirects; session/logout behavior. | PENDING |
| `dashboard.html` | Own account counts/recent items/plan, refresh, empty/error states and Studio/Library links; no stale data after account switch. | PENDING |
| `studio.html` | Permission requested only on Record; Record/Stop/timer, upload fallback, player, Premium controls, intensity and Reset; release microphone on navigation. Saves local only. | PENDING |
| `marketplace.html` | Search/category/license/price filters, responsive cards, preview, loading/empty/error/retry. | PENDING |
| `voice-details.html?id=<uuid>` | Valid/invalid/missing/unavailable ID, preview, offer availability, terms, local Demo Checkout/report form; no private full path in listing HTML. | PENDING |
| `my-library.html` | Keyboard tabs for originals/edits/listings/licenses; own/authorized play/download; local publisher/archive controls, loading/empty/error/retry and URL-hash tabs. | PENDING |
| `admin.html` | Guest redirects; ordinary user forbidden; existing local admin sees keyboard tabs, users/listings/reports and loading/error/empty states. Mutations only on local disposable targets. | PENDING |

Also simulate offline/failed requests, rapid actions, signout/account switch while
requests are pending, expired sessions and a fresh empty local account. A stale
response must not reveal another account's private data or re-enable invalid
actions. Confirm new requests remain subject to server authorization.

## Screenshot evidence and final release gate

**PENDING:** capture actual application screenshots from at least five distinct
pages, with at least one mobile view. Suggested evidence is Landing, Dashboard,
Studio, Marketplace, My Library and Admin. Use local disposable content, hide
emails/credentials/tokens, record viewport/date/persona, and add the actual files
and links to README after capture. Do not create mock screenshots or treat an
empty image placeholder as evidence.

Before committing, review every changed file for scope/security, run local checks,
record PASS/FAIL/SKIP honestly, and confirm any unresolved database/browser/live
items are visible in the release notes. No automatic commit, push, deployment,
remote migration or remote data mutation is part of Prompt 18's local execution.
