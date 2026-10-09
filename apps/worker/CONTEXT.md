# StreamFusion Worker

The Cloudflare Worker supports Kick OAuth only. It keeps the Kick client secret out of the desktop app and rate-limits token operations.

## Responsibilities

- Exchange and refresh Kick OAuth tokens.
- Apply IP- and subject-scoped rate limits to token operations.
- Return the public Kick client ID from `GET /auth/kick/config` without exposing the client secret.
- Serve a no-store callback landing page at `GET /auth/kick/android/callback`. A user gesture opens the matching development or production app scheme. The token exchange still uses the canonical HTTPS redirect.

## Boundaries

- The desktop and mobile apps own the user experience and local application state.
- The worker owns the server-side Kick client secret and OAuth token boundary.
- The apps call Kick data APIs directly. The worker does not proxy channels, streams, categories, chat, moderation, or other account data.
- Shared architectural decisions belong in `docs/adr/`; worker-only decisions may live in `apps/worker/docs/adr/`.
