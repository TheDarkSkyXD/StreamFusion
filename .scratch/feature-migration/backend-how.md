# Desktop backend migration record

Scope: `apps/desktop/src/backend` from `9ef82510a1571848ecaa8d4dee4ef7ea390393c2`.
The companion [backend map](backend-map.json) records **376** concrete old-to-new
paths: **189** production modules and **187** feature-owned tests. It retains 82
main-process bootstrap, shared transport, and low-level driver modules. All nine
backend feature roots contain the prescribed `routes`, `components`, `domain`,
`capabilities`, `adapters`, `data`, `utils`, `composition`, and `tests` folders.

## Runtime ownership

`backend/main.ts`, `backend/preload/index.ts`, trusted IPC registration, sender
origin validation, cleanup registry, window/process bootstrap, logging, URL
protocols, and generic encrypted/database drivers remain runtime infrastructure.
They are not feature forwarding shells. A feature route validates its payload and
origin, calls its workflow or adapter, and maps the result. Main-only capability
implementations stay in backend features; browser-safe chat/emote code moved to
the frontend chat feature. `src/shared` contains serialization-safe contracts,
including the slot bridge, Kick moderation results, Twitch EventSub payloads,
search types, playback types, and pure stream identity utilities.

## Completed responsibility splits

- `stream-handlers.ts` was removed. Discovery now owns `stream-routes.ts`; the
  playback URL IPC command is in `playback/routes/stream-playback-routes.ts`.
- Preferences have a Settings repository and typed route. Authentication owns
  `follow-routes.ts`, including sender-gated account writes and renderer event
  forwarding. The remaining `storage-handlers.ts` registers only generic
  `STORE_*` compatibility channels.
- Authentication transport moved to `authentication/routes/auth-routes.ts` with
  no legacy export. Its token/identity status decision is the injected pure
  `domain/auth-status.ts` workflow.
- Twitch EventSub start/stop registration is now moderation-owned. The shared
  `TWITCH_API` command envelope still has mixed chat/moderation operations and
  remains the next explicit extraction unit.
- Official Kick ban, timeout, unban, and mode operations now cross a narrow
  validated preload/main route. Credentials are retrieved and used only in main.
- Backend playback imports `StreamPlayback` from `@shared/playback-types`; no
  backend resolver imports renderer component types.

The remaining hard splits in the manifest are intentionally explicit: the
`database-service` and `storage-service` still expose shared
drivers while feature repositories are extracted incrementally, and the Twitch
command envelope needs per-feature routes. None is marked as completed merely
by relabeling a path.

## Test ownership and evidence

Feature unit/service/route tests moved with their source below
`src/backend/features/<feature>/tests`. Cross-process and renderer integration
tests remain under `tests/` because they prove runtime boundaries. The map lists
each original test path and its current feature target. The six DOM-node
exceptions remain identifiable by their relocated paths: Kick follow-grid,
auth-header predicate, Twitch chat, Twitch pin poller, emote manager, and Kick
emotes.

Focused checks passed after the follow split: 13 tests across the follow-route
and account-write-origin suites. Scoped ESLint passed for the changed routes,
data modules, HLS resolver/cache, and loader. Filtered desktop TypeScript checks
were clean for the moved auth, storage/follow, playback, browser-chat import,
and shared-contract paths. Full-repository typecheck remains a coordinated
integration check because renderer ownership and global test configuration are
being repaired in parallel.

## Provider client ownership completed

The former KickClient and TwitchClient modules are deleted. Their callers use
feature-owned discovery, playback and account readers. Kick request retry, rate
limits, token refresh, isolated CDN session, binary response limits and image
caches remain in kick-transport. Twitch endpoints consume the narrow
TwitchHelixRequestPort. Their shared TwitchRequestor retains request policy.

Authentication owns the signed-in user and account-follow endpoint implementations
and the Kick followed-page predicate. The predicate's DOM test moved with it,
and its explicit Vitest environment path was updated. Search now receives
discovery and recorded-content readers separately. Channel routes receive the
Twitch account-follow reader separately. No removed client path has a re-export
or a production caller.

Verification passed for desktop TypeScript, scoped ESLint, 451 provider and
caller tests, 170 follow and reader tests, and six DOM predicate tests. Some
reader tests remain in the cross-feature transport test directory because each
suite verifies multiple feature adapters with the shared request transport.

The separate GraphQL endpoint extraction is assigned to the integration agent.
It remains explicit work until its request transport and discovery/playback
endpoint modules have been separated and verified.
