# StreamFusion Worker

The Cloudflare Worker supports Kick OAuth only. It keeps the Kick client secret out of the desktop app and rate-limits token operations.

## Responsibilities

- Exchange and refresh Kick OAuth tokens.
- Apply IP- and subject-scoped rate limits to token operations.

## Boundaries

- The desktop app owns the user experience and local application state.
- The worker owns the server-side Kick client secret and OAuth token boundary.
- The desktop app calls Kick data APIs directly. The worker does not proxy channels, streams, categories, chat, moderation, or other account data.
- Shared architectural decisions belong in `docs/adr/`; worker-only decisions may live in `apps/worker/docs/adr/`.
