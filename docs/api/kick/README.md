# Kick API Reference

> Internal docs for Kick API integration in StreamFusion.
> Official docs: <https://docs.kick.com/>
> Source code: [`apps/desktop/src/backend/api/platforms/kick/`](../../../src/backend/api/platforms/kick/)

## 📚 Table of Contents

1. [Overview](#overview)
2. [Base URLs](#base-urls)
3. [Authentication](./authentication.md)
4. [Endpoints by Resource](./endpoints.md)
5. [Rate Limits & Retries](./rate-limits.md)
6. [Webhooks & Events](./webhooks-and-events.md)
7. [Implementation Notes](./implementation-notes.md)
8. [Flat-list reference](../kick-api-endpoints.md) — every known endpoint, including ones we don't (yet) call.

## Overview

StreamFusion talks to Kick through **three distinct API surfaces**, each with different auth, rate limits, and reliability characteristics:

| Surface | When used | Reliability |
|---|---|---|
| **Public API (official)** | Default for authenticated users — channels, streams, categories | High; documented |
| **Private/legacy `api/v1` & `api/v2`** | VODs, clips, chatroom IDs, unauthenticated channel info | Medium; undocumented, subject to change |
| **Hidden BrowserWindow scrape** | Unauthenticated channel lookups when Cloudflare blocks `electron.net` | Low; expensive (full Chromium renderer per call) |

The public API is **proxied through a Cloudflare Worker** at `streamfusion.leveluptogetherbiz.workers.dev/kick/...` so we don't need to surface OAuth client secrets to the desktop client. The Worker forwards to `https://api.kick.com/public/v1`.

## Base URLs

| Type | URL | Auth |
|---|---|---|
| **Public API (proxied)** | `https://streamfusion.leveluptogetherbiz.workers.dev/kick` | OAuth Bearer |
| **Public API (direct, for reference)** | `https://api.kick.com/public/v1` | OAuth Bearer |
| **Internal v2 (legacy)** | `https://kick.com/api/v2` | Cookie / Cloudflare bypass |
| **Internal v1 (legacy)** | `https://kick.com/api/v1` | None / cookie |
| **Private (anonymous)** | `https://api.kick.com/private/v1` | None |
| **Unofficial search** | `https://kick.com/api/search` | None |

These constants live in [`kick-types.ts`](../../../src/backend/api/platforms/kick/kick-types.ts) as `KICK_API_BASE`, `KICK_LEGACY_API_V1_BASE`, `KICK_LEGACY_API_V2_BASE`.

## ⚠️ Notes for new contributors

- **Don't add a new caller for `getPublicChannel()` on a hot path.** It opens a hidden Chromium window per call, serialised behind a global mutex (see [`rate-limits.md`](./rate-limits.md#browserwindow-mutex)). It's fine for one-off lookups (channel-page open, chat join); it's not fine for batch enrichment.
- **Prefer `getChannelsBySlugs()` over a loop of `getChannel()`** — one HTTP request handles up to 50 slugs.
- **The official API has known identity-mismatch bugs** on single-slug queries; `getChannel()` validates the response slug matches the request before returning. See [`implementation-notes.md`](./implementation-notes.md#identity-mismatch-defense).
