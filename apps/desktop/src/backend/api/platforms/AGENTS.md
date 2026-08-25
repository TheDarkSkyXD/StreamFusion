# PLATFORM API CLIENTS

**Read this file before modifying code in this directory.**

## Purpose
Owns all HTTP/GQL communication with Twitch and Kick. Platform-specific clients, requestors, endpoint definitions, and response transformers. Does NOT own: chat WebSocket connections (see `../../services/chat/AGENTS.md`), UI components, or state management.

## OVERVIEW
Twitch and Kick API implementations with unified type transformers.

## STRUCTURE

```
platforms/
├── kick/
│   ├── kick-client.ts        # Main client (God Object - 571 lines)
│   ├── kick-requestor.ts     # HTTP layer, auth tokens
│   ├── kick-transformers.ts  # → UnifiedStream, UnifiedChannel
│   ├── kick-types.ts         # Raw API response types
│   └── endpoints/            # Domain-specific calls
│       ├── stream-endpoints.ts   # Live streams (622 lines)
│       ├── user-endpoints.ts
│       └── video-endpoints.ts
├── twitch/
│   ├── twitch-client.ts      # Main client
│   ├── twitch-requestor.ts   # Helix API auth
│   ├── twitch-transformers.ts
│   ├── twitch-types.ts
│   ├── twitch-gql-helpers.ts # Supplemental GQL queries
│   └── endpoints/
└── ../unified/
    ├── platform-types.ts     # UnifiedStream, UnifiedChannel, etc.
    └── platform-client.ts    # IPlatformClient interface (target)
```

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Add Kick endpoint | `kick/endpoints/*.ts` |
| Add Twitch endpoint | `twitch/endpoints/*.ts` |
| Transform response | `*-transformers.ts` |
| Unified types | `../unified/platform-types.ts` |

## CONVENTIONS

### Adapter Pattern
Each client transforms raw API → Unified types via `*-transformers.ts`.

### Requestor Pattern
- Twitch: Standard `fetch`, OAuth2 app token
- Kick: `electron.net` (IPv6 issues), signed-in user token for official API calls

### Method Naming
```
getStreamBySlug (Kick)  ↔  getStreamByLogin (Twitch)
getTopStreams           ↔  getTopStreams
```

## ANTI-PATTERNS

- **kick-client.ts**: Mixes HTTP, auth, retries, and endpoint delegation
- **stream-endpoints.ts**: Manual `net.request` reimplementation
- Kick has official Public API docs at `https://docs.kick.com/`; legacy/undocumented APIs still exist as fallbacks for gaps. See `kick/AGENTS.md`.

## NOTES

- Kick has official Public API docs, but some StreamFusion behavior still depends on reverse-engineered `kick.com/api/*` routes where the official API has gaps.
- Twitch uses official Helix plus web GQL supplements. See `twitch/AGENTS.md`.
- Pagination differs: Twitch (cursor), Kick (page numbers sometimes)
