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
