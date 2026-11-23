# EchoVault demo accounts and handover

**Status: PENDING.** Verified demo credentials and a production URL have not been
provided for Prompt 18. No account, role, subscription or remote application data
was created/modified by writing this guide. An example persona is not proof of a
working account. Do not publish real user credentials or invent account details.

The only permitted cloud development target is **echovault-dev**, project
reference **`zysyghbbbesatbehravb`**. Before any separately authorized cloud work,
verify both the selected dashboard project/reference and the app's actual
Supabase URL. Never use or modify the separate primary **echovault** project.

## Required demonstration personas

Use purpose-created accounts with controlled test addresses, consented audio and
replaceable passwords. Register each normally so the signup trigger first gives
it a `user` role and `free` subscription. Prepare on an isolated local Supabase
for validation; cloud preparation requires separate authorization.

| Persona | Intended role / plan | Purpose | Verified account |
|---|---|---|---|
| Free Seller | `user` / `free` | Original recording/upload, persistent library and Premium lock | PENDING |
| Premium Seller | `user` / active `premium` | Real effects/WAV export and separate public preview/listing | PENDING |
| Buyer/Renter | `user` / `free` | Demo Buy/Rent receipts, authorized audio and report flow | PENDING |
| Unrelated User | `user` / `free` | Cross-user private-file/report/admin denials | PENDING |
| Demo Admin | `admin` / `free` unless separately assigned | Read-only users, listing/report moderation and demo-plan tools | PENDING |

Expired-rental/concurrency scenarios need additional disposable **local** fixtures;
never alter a shared account's license expiry or reuse real purchases to create a
negative test. Admin and Premium are independent: admin bootstrap must leave the
subscription unchanged.

## Local preparation procedure

1. Start isolated local Supabase and apply the repository's migrations in order.
   Verify both the browser Supabase URL and trusted SQL connection point to the
   local stack. Keep cloud CLI links separate from this check.
2. Register new disposable personas through normal signup, confirm email if the
   local configuration requires it, and privately record their exact UUIDs.
   Verify profile/default role/default Free plan before assigning any privileges.
3. For **only** the new disposable local Demo Admin, use a private copy of
   [bootstrap_demo_admin.sql](../supabase/manual/bootstrap_demo_admin.sql) in
   trusted local SQL. Independently verify its exact UUID and stored email, then
   deliberately fill both null placeholders in that copy. The unedited checked-in
   template stays disabled and must abort. Never run it as a migration or expose
   an admin-registration endpoint.
4. Sign in as that local admin and use its protected demo-plan tool only on the
   new disposable Premium Seller. Verify DB expiry and that role stays `user`.
   Do not modify existing Free User A, seller User B, Premium testers or real
   accounts. No service-role/secret key belongs in browser configuration.
5. Prepare new consented samples, separate previews and demo offers/licenses only
   in this local fixture environment. Record fixture IDs so the checklist can
   target them precisely. Keep objects instead of running old cleanup scripts.

For an authorized future cloud preparation, repeat identity/target verification
against `echovault-dev` and obtain the required separate approvals before each
remote migration/bootstrap/data preparation step. This guide does not grant that
authorization or claim it has occurred.

## Private credential handover

The project owner should deliver verified **demo-only** login details to the
presenter/reviewer through an access-controlled private channel. Keep passwords
out of README, Git commits, screenshots, public Pages, browser client source and
`VITE_*` environment values. Do not send credentials automatically from this
project. Supply only the demo access required for assessment and rotate passwords
afterward.

The private handover should state:

- Real application URL and the verified Supabase project/reference.
- Persona → actual controlled demo email, password and expected role/plan.
- When login was verified and when any Premium/rental expires, using DB time.
- Which new consented listing/audio examples the assessor can use.
- Any browser, email-confirmation, deployment or runtime limitation still open.

Public documentation can record persona readiness and the eventual verified live
URL, while referring to that private handover for passwords. Until credentials
are actually supplied and tested, the demo-account acceptance item remains
**PENDING/SKIP**, not PASS. Follow [the test checklist](test-checklist.md) and
[five-minute demo script](demo-script.md) for the remaining demonstration work.
