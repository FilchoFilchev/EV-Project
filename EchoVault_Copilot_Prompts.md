# EchoVault — готови GitHub Copilot prompts

**Как да ги използваш:** Давай **един prompt наведнъж** в Copilot Chat/Agent. Преглеждай генерираните промени, стартирай проекта, тествай и commit-вай само след успешно изпълнение. Приложи основния `EchoVault_Project_Blueprint.md` и `.github/copilot-instructions.md` като контекст.

## Prompt 01 — Project Setup
> Read `.github/copilot-instructions.md`. Initialize or adapt this repository into a Vanilla JavaScript + Vite + Bootstrap 5 multi-page app. Do not use React, Vue, TypeScript, or SPA routing. Create package scripts, environment example, gitignore, and README scaffold. Explain all added files. Do not add actual secrets. Verify `npm run build` and give manual test steps.

## Prompt 02 — HTML Pages and Navigation
> Implement all nine HTML entry pages from `EchoVault_Project_Blueprint.md` (index, register, login, dashboard, studio, marketplace, voice-details, my-library, admin) with distinct page JS modules, shared responsive navbar/footer, semantic markup, active navigation, and Bootstrap styles. Configure Vite multi-page inputs for the installed Vite version. Do not add mock Supabase data yet. Test production build and all page URLs.

## Prompt 03 — Supabase Client
> Create a single reusable Supabase browser client initialized from VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, with config validation and clear error feedback. Avoid service-role/secret keys. Add auth state helpers and a protected route guard that redirects anonymous users to login. Do not expose privileged operations to the browser.

## Prompt 04 — Schema Migration
> Based on the Blueprint's eight-table schema, generate a complete versioned Supabase SQL migration with PK/FK, CHECK constraints, unique constraints, defaults, indexes, sensible on-delete restrictions, and ENABLE ROW LEVEL SECURITY on all public tables. Explain normalization and relationship choices. Do not include permissive RLS policies. Include a repeatable migration test checklist.

## Prompt 05 — Signup Bootstrap
> Implement secure DB trigger logic that creates `profiles`, `user_roles(role='user')`, and `subscriptions(plan='free')` after a Supabase auth.users signup. Make trusted code idempotent where possible, pin search_path for SECURITY DEFINER, and avoid letting a user self-assign roles or plans. Add manual tests for registration, duplicate handling, and failed trigger visibility.

## Prompt 06 — RLS Policies
> Create a separate Supabase SQL migration implementing the RLS matrix from the Blueprint for all eight tables. Include helper functions in a non-exposed private schema for admin, premium, and licensed audio access. Handle USING/WITH CHECK, grants, immutable identifiers, archive behavior, and potential recursive policy dependencies. Add negative tests for cross-user access and role/plan escalation. Do not assume `auth.uid()` can be faked from client input.

## Prompt 07 — Register and Login
> Build register/login/logout with Supabase Auth, proper form validation, loading/error states, optional email confirmation flow, session persistence, redirects, and responsive Bootstrap UI. Fetch display name and role only after a verified session. Avoid storing sensitive claims as editable localStorage authorization flags.

## Prompt 08 — Microphone Recorder
> Implement a real microphone recorder for studio.html using getUserMedia and MediaRecorder. Check browser MIME support, request microphone permission only after user action, support Record/Stop/Play and timer, release stream tracks, catch permission errors, and include audio-file upload fallback. Do not persist data yet; include a clear manual test protocol.

## Prompt 09 — Storage Upload + Personal Library
> Add private Supabase Storage bucket access with user-scoped object paths, upload of the original recording, database creation of voice_recordings and exactly one original voice_versions record, My Library listing, and protected file download. Avoid upsert and public full-audio URLs. Handle partial failures by cleaning unreferenced owned uploads. Include negative test with a second user.

## Prompt 10 — Muffle Effect
> Implement a real Muffle low-pass filter in audioEngine.js using Web Audio API BiquadFilterNode. Add Original/Muffle selection and intensity UI. Preview must audibly change the signal and Reset must restore the original. Keep the original immutable. Add unit/manual tests where practical.

## Prompt 11 — Distortion and Echo
> Add real Distortion (WaveShaperNode) and Echo (DelayNode with controlled feedback/mix) with safe signal levels. Implement intensity controls, no clipping beyond reasonable limits, audible preview, and Reset. Keep all audio logic inside audioEngine.js, not studioPage.js.

## Prompt 12 — Offline Export and Premium
> Implement OfflineAudioContext rendering to an actual WAV Blob, upload it as a new private voice version, and store effect_type/settings metadata. Add Premium-only UI and a server-side policy/check preventing Standard users from inserting edited versions. Ensure no fake UI-only processing. Add an API attack test trying to insert edited version as Free user.

## Prompt 13 — Listings and Public Previews
> Implement publishing a user-owned voice version to a Marketplace listing with euro-cent prices, demo sale/rental options, 30-day rental, and a 5–8 second public preview stored separately from the paid private file. Require ownership and a public source recording. Validate file size, preview length, and prices. Archived listings must not break existing licenses.

## Prompt 14 — Marketplace Search and Detail
> Build responsive marketplace cards, category/title search, filters, preview player, and voice-details.html?id=<uuid>. Fetch only permitted published listings using Supabase queries/RLS. Add loading, empty, error, and unauthorized states. Never render a private full audio URL in listing HTML.

## Prompt 15 — Secure Demo Buy/Rent
> Implement a transaction-safe Supabase PostgreSQL RPC named demo_checkout(p_listing_id uuid, p_license_type text), using auth.uid() and server-stored listings/prices. Only allow published listings, never allow purchasing own listing, reject duplicate permanent purchases, set 30-day rent expiry using DB now(), persist price snapshot, and return license ID. Grant execute only to authenticated and test direct abuse. This is DEMO CHECKOUT, not real payment.

## Prompt 16 — Licensed Downloads
> Implement a protected audio download flow. The owner or buyer with a valid license can download from the private voice-files bucket; other users cannot. Ensure expiring rental access uses DB time and that archived listings do not revoke existing perpetual buys. Use short-lived authorized URLs where needed, and add deny tests using a second user.

## Prompt 17 — Admin and Reports
> Create admin-only panel with users, reports, listings and demo Premium status tools. Implement secure admin RPC/policies and manual admin bootstrap from trusted SQL. Add report creation by users, resolve report, archive listing, and demo premium assignment. Add tests proving a non-admin cannot access admin tables or RPC even if they call REST directly.

## Prompt 18 — Polish, Deployment and Docs
> Perform a final audit against the SoftUni Capstone rubric: 9 responsive pages, ≥8 tables, admin, Supabase Auth/Storage/RLS, upload/download, migrations in repo, 15+ authentic commits across 3+ calendar days, Netlify production build, README architecture + ER diagram + setup + demo accounts. Fix issues one at a time; do not fabricate test results or Git history. Produce a 5-minute demo script and test checklist.

## Universal debugging prompt
> Diagnose this specific error without rewriting unrelated code. First explain the likely cause, then identify the minimum files to change, propose the smallest fix, and show how to reproduce and verify the fix, including a negative security case if data access is involved. Here are the error and steps: [PASTE ERROR AND STEPS].

## Universal code review prompt
> Review only the current diff against `.github/copilot-instructions.md` and the Blueprint. Check frontend framework constraints, authentication, RLS, data ownership, Storage permissions, SQL migration reproducibility, accessibility, and build compatibility. List high/medium/low severity issues and concrete fixes; do not claim runtime verification without executing tests.
