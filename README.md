# EchoVault

EchoVault is a SoftUni AI Capstone multi-page web application for recording,
transforming, storing, and demo-licensing voice recordings.

This repository currently contains the project setup. The application is
implemented incrementally, one feature prompt at a time.

## Technology

- HTML5 and CSS3
- Vanilla JavaScript ES modules
- Bootstrap 5
- Vite and npm
- Supabase Auth, PostgreSQL, and Storage

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Environment variables

Copy `.env.example` to `.env` and supply only the browser-safe Supabase values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never place service-role, secret, JWT signing, or payment provider keys in
`VITE_*` variables or in this repository.

## Authentication

Register and login use Supabase email/password authentication. Registration
sends only the display name as user metadata; the database signup trigger
creates the profile, default `user` role, and `free` subscription. Email
confirmation behavior follows the Auth settings of the configured Supabase
project, and the UI supports both confirmation-required and immediate-session
signups.

Protected pages verify the current Supabase user before revealing their
content. The Admin page additionally reads the caller's role from `user_roles`;
browser checks are only a navigation safeguard, while database RLS remains the
authorization boundary. For local development, `.env.local` should point to
`echovault-dev` and contain only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`.

The transactional confirmation-email source is
[docs/email-templates/confirm-signup.html](docs/email-templates/confirm-signup.html).
It is a local template only; apply it only in the development project's Auth
email-template settings if the current plan and SMTP configuration permit
customization. No Supabase email settings are changed by this project.
