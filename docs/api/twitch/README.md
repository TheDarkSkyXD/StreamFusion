# Twitch API Reference

> Internal docs for Twitch API integration in StreamFusion.
> Official Helix docs: <https://dev.twitch.tv/docs/api/>
> Source code: [`apps/desktop/src/backend/api/platforms/twitch/`](../../../src/backend/api/platforms/twitch/)

## 📚 Table of Contents

1. [Overview](#overview)
2. [Base URLs](#base-urls)
3. [Authentication](./authentication.md)
4. [Helix REST API](./helix-api.md)
5. [GraphQL Gateway](./gql-api.md)
6. [Rate Limits & Retries](./rate-limits.md)
7. [Implementation Notes](./implementation-notes.md)

## Overview

Twitch exposes **two API surfaces**:

| Surface | Auth | Used for |
|---|---|---|
| **Helix REST** (`api.twitch.tv/helix`) | User OAuth Bearer | Anything that needs the logged-in user's identity: followed channels, follower count, sending chat, modding |
| **GraphQL gateway** (`gql.twitch.tv`) | Public Client-ID (no user token) | Top streams, search, channel/video metadata, playback access tokens — anything that's publicly visible on twitch.tv |

We **prefer GQL for public data** because (a) it requires no user authentication and so works for logged-out users, (b) it's cheaper per call than equivalent Helix requests, and (c) it returns richer data in one round trip (cover art, tags, follower counts inline). Helix is reserved for authenticated/scoped endpoints. Many functions in `twitch-client.ts` try GQL first and fall back to Helix when GQL is unavailable.

## Base URLs

| Type | URL | Auth |
|---|---|---|
| **Helix (proxied)** | `https://streamfusion.leveluptogetherbiz.workers.dev/twitch` | User OAuth Bearer |
| **Helix (direct, for reference)** | `https://api.twitch.tv/helix` | User OAuth Bearer + `Client-Id` |
| **GraphQL gateway** | `https://gql.twitch.tv/gql` | Public `Client-ID` header (no user token) |
| **OAuth** | `https://id.twitch.tv/oauth2` | n/a |
| **HLS playback** | `https://usher.ttvnw.net` | Signed token from GQL `PlaybackAccessToken` |

Constants live in [`twitch-types.ts`](../../../src/backend/api/platforms/twitch/twitch-types.ts) as `TWITCH_API_BASE`, `TWITCH_AUTH_BASE`.

## ⚠️ Notes for new contributors

- **The GQL Client-ID is `kd1unb4b3q4t58fwlpcbzcbnm76a8fp`** (Twitch Android app). It's public and stable. Do NOT replace with our own Helix Client-ID — GQL rejects it.
- **Persisted-query hashes are versioned by Twitch.** The [`twitch-gql-queries`](https://www.npmjs.com/package/twitch-gql-queries) npm package tracks them; if a GQL query returns `PersistedQueryNotFound`, bump that package.
- **Helix is rate-limited per-user-token** (800 points / minute). We don't currently track points; we react to `429` headers. See [`rate-limits.md`](./rate-limits.md).
- **GraphQL has no auth on public reads**, but it does have a global IP-based rate limit. Don't add a busy poll against GQL.
