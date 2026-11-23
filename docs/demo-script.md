# EchoVault five-minute demo

This is a presentation plan, not a record of tests already performed. Rehearse on
an isolated **local** Supabase with disposable accounts and consented audio. Any
cloud account creation, role/plan changes, migration or deployment needs separate
authorization and must target only `echovault-dev` (`zysyghbbbesatbehravb`). Never
use the primary `echovault` project. Prompt 18 makes no remote changes.

## Prepare before the clock starts

- Start the app and isolated local Supabase, applying existing migrations only
  to that disposable local database. Verify the browser is using the local URL.
- Prepare distinct local Free Seller, Premium Seller, Buyer/Renter and Demo Admin
  personas. Ordinary signup creates each as `user`/`free`. In trusted **local**
  SQL bootstrap only the disposable Demo Admin, using a deliberately configured
  private copy of `supabase/manual/bootstrap_demo_admin.sql`; keep the repository
  template disabled. Use that local admin's checked tool for the disposable
  Premium Seller. Admin and Premium remain independent.
- Keep verified demo-only credentials privately available to the presenter. No
  credentials are provided or invented by this script. Confirm email if required.
- Prepare a 12+ second consented sample and a saved original/edited version as a
  fallback. Use headphones and rehearse permission/audio behavior in the browser.
- Open the README, [architecture](architecture.md), [ER diagram](er-diagram.md),
  local SQL test output and genuine Git log. Run tests beforehand; show actual
  output with its date/limits. Never present source-contract checks as live RLS.
- If a production URL has not been deployed and tested, explicitly say so. Do
  not substitute a fabricated URL or imply the local preview is production.

## Timed presentation

| Time | Action | Explain or verify |
|---|---|---|
| 0:00–0:30 | Show Landing, Register and Login; sign in as Free Seller. | Nine separate HTML pages, responsive Bootstrap UI, Supabase Auth. Registration requires rights/rules acknowledgement; database defaults create a regular Free account. |
| 0:30–1:15 | Open Studio, record a short sample or choose the prepared file, play it, and Save original. Open My Library and reload. | A real private upload and persistent metadata, not mock audio. Premium controls stay locked for Free. Use the prepared saved original if permission or network blocks the live step, and state the reason. |
| 1:15–2:00 | Switch to Premium Seller. Load a prepared original, choose Muffle, change intensity, preview/reset, render and save the edited WAV. | Real Web Audio processing and offline WAV export; original and edited versions remain separate. Mention Distortion and Echo and the server-side Premium policy. |
| 2:00–2:45 | In My Library publish an owned version, generate a separate 5–8 second preview, confirm rights/public metadata and set demo Buy/Rent prices. Open Marketplace, filter/search and inspect details. | Public promotional preview, private full file, euro-cent offers, 30-day rental, consent requirement and safe listing metadata. |
| 2:45–3:30 | Switch to Buyer/Renter, complete **Demo Rent**, open Acquired licenses, play/download full audio. | No real money is charged. Database chooses buyer, price and 30-day expiry. A permanent Demo Buy is non-exclusive file use, not ownership of the seller's voice. |
| 3:30–4:15 | Submit a report as Buyer/Renter. Switch to Demo Admin, review Users/Reports/Listings, resolve the report and archive the new demo offer. | Admin-only RPCs and report evidence. Marketplace offer disappears while an already valid buyer/renter keeps access. Show Premium/Free controls on disposable personas only; no role escalation from UI. |
| 4:15–5:00 | Show ER diagram, private/public bucket settings, genuine Git history and observed negative-test evidence; briefly resize to mobile. | Eight tables, version/license relationships, grants/RLS, existing migrations, 15+ commits across 3+ real days. Explain expired rent blocks new downloads and unlicensed users/admins cannot read private audio. Show production URL only if actually verified. |

## If a live step fails

State the observed error and use the prepared artifact or already recorded test
output, identifying it as such. Do not repeatedly mutate data to hide a failure,
run cleanup scripts, fabricate successful results, or change existing shared
roles, subscriptions, listings or licenses. The five-minute demo should show
working behavior while making incomplete browser/database/deployment acceptance
clear. Use [Blueprint section 12](../EchoVault_Project_Blueprint.md#12-acceptance--тестови-сценарии)
as the acceptance checklist, recording PASS, FAIL and SKIP separately before the
final presentation.
