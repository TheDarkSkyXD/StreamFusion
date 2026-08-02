# Issue 08: semantic placeholder cleanup proof

## Superseded feature-stub search

From the repository root:

```powershell
rg -n "Chat replay not available for this video|Subtitles Placeholder|Placeholder - will be resolved by BadgeResolver|channel/.*stub|empty placeholder index files" apps/desktop/src apps/desktop/documentation docs --glob '!docs/plans/**' --glob '!docs/brainstorms/**' --glob '!docs/test-audit/**'
```

Result: no matches. The Video page now mounts `ChatReplaySession`; the player settings menu only exposes Subtitles/CC when timed-text tracks exist.

## Legitimate placeholder categories preserved

Targeted counts under `apps/desktop/src` after cleanup:

| Category | Search | Matches |
|---|---|---:|
| Input hints | `placeholder=` | 38 |
| Loading skeletons | `Skeleton` | 77 |
| Cached-data states | `isPlaceholderData` | 17 |
| Multiview WCV host surfaces | `WCV.*placeholder\|placeholder.*WCV` | 8 |
| Proxy image fallbacks | `isProxyPlaceholder\|placeholderResponse` | 13 |

## Relevant regression tests

```powershell
cd apps/desktop
npm test -- --run tests/backend/services/chat/twitch-parser.test.ts tests/components/player/caption-foundation.test.tsx tests/pages/Video.test.tsx
```

Result: 3 files passed, 46 tests passed. The caption suite emitted existing React `act(...)` warnings but no failures.

## Quality checks

- `npx biome check src/backend/services/chat/twitch-parser.ts`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run lint`: currently blocked by formatting in active Issue 07 files (`chat-replay-session.tsx` and `use-chat-replay.ts`); no Issue 08 file was reported.
