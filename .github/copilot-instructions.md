# EchoVault — Copilot Agent Instructions

## Context
EchoVault is a SoftUni AI Capstone **multi-page** vanilla JavaScript web application for voice recording, audio transformation, storage, marketplace listings, and **demo-only** licensing. It is not a real payment product.

## Mandatory technology constraints
- Use HTML5, CSS3, vanilla JavaScript ES modules, Bootstrap 5, npm, Node.js, Vite.
- Use Supabase Auth, PostgreSQL via Supabase JS client (REST), and Supabase Storage.
- Do NOT use React, Vue, TypeScript, Next.js, Express, or an SPA router for the frontend.
- Each screen must be a distinct `.html` file; each screen has its own JS page module.
- Keep UI, services, business logic, utilities, and styles modular and in separate files.

## Product and security rules
- Users must sign in before using audio recording, marketplace, and personal library.
- Roles: `user`, `admin`. Subscription plan: `free`, `premium` (not a role).
- Audio originals are never overwritten; edited versions are separate files and DB rows.
- Edited version creation requires a server-side active premium check; hiding UI controls is not sufficient.
- Full audio is always in a private Supabase Storage bucket. Public previews use a separate public bucket.
- Purchased/rented access is license-based; 30-day rental is checked against DB time.
- `demo_checkout` must not accept price, buyer ID, seller ID, or license expiry from the client. Compute values on the server from DB state and auth.uid().
- Never expose Supabase secret/service role keys in browser code, `VITE_*` env vars, or GitHub.
- Enable RLS for every public table and write allow/deny tests. No admin role elevation from frontend.
- Use DB migrations, not manually maintained production-only schema.
- Voice rights: creators must confirm they have permission and rights; support reports and admin moderation.

## Implementation practices
1. Implement only the specific requested feature and its dependencies; avoid sprawling refactors.
2. State files changed and summarize behavior and security impact.
3. Include input validation, loading/empty/error states, and responsive Bootstrap markup.
4. Prefer small functions and focused services over monolithic files.
5. Write migrations for schema/policy changes under `supabase/migrations/`.
6. Provide manual test steps including negative unauthorized cases; propose automated tests for critical logic.
7. Never claim tests passed unless they were run and observed to pass.
8. Use actual MediaRecorder/Web Audio API effects and OfflineAudioContext/WAV export, not decorative/mock audio processing.
9. Do not use fake transactions styled as real payments. Always label Demo Checkout.
10. For Supabase protected RPC, enforce auth checks and input validation in SQL; use pinned search_path for SECURITY DEFINER.

## Definition of done for each feature
- Feature works on desktop and mobile.
- Error handling and unauthorized access are addressed.
- `npm run build` passes.
- Supabase migrations and RLS tests are applied if relevant.
- Changes are reviewed and committed to GitHub once verified.
