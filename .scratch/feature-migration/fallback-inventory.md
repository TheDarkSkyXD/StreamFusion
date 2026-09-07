# Fallback inventory, 2026-09-06

Yes: this bounded review identified **23 distinct fallback implementation units** below. This is a verified minimum, **not an exhaustive repository total**. Counting every `||`, `??`, catch, retry, placeholder, and alternative provider would require a wider behavioral audit. No production source was changed.

## Reproducible scope and counts

Ran `node .scratch/feature-migration/count-fallbacks.cjs` using `rg --files` and the TypeScript AST. Source roots: desktop/src, mobile/src, mobile/app, core/src, worker/src, integration-relay/src. Included .ts/.tsx/.js/.mjs/.cjs; excluded tests, __tests__, testing, locales, i18n, dev directories, declarations, test/spec/story files. Configs, scripts, built output and dependencies are outside these roots. Embedded development branches in ordinary source remain in the lexical totals.

| Scope | Files scanned | Keyword lines | Files with keyword | AST fallback identifier occurrences |
|---|---:|---:|---:|---:|
| Desktop | 927 | 680 | 177 | 516 |
| Mobile src + app | 33 | 20 | 3 | 4 |
| Core | 27 | 1 | 1 | 1 |
| Worker | 8 | 0 | 0 | 0 |
| Integration relay | 2 | 0 | 0 | 0 |
| Total | 997 | 701 | 181 | 521 |

Keyword lines match case-insensitive `fallback|fall.back` and can include comments/strings. AST identifiers exclude comments and string contents, but still include repeated references and type declarations. Neither count is a count of behaviors. The core match is an optional `allowInteractiveFallback` contract field, not an implementation. Zero keyword matches does not prove zero implicit fallbacks.

Artifacts: fallback-counts.json, fallback-source-lines.json and count-fallbacks.cjs in this directory. The earlier fallback-occurrences.txt used a broader exploratory scope; use the JSON totals above for the reported numbers.

## Reviewed implementation units

One unit means one owner workflow with a primary and substitute path. Shared helper call sites and multiple failure reasons are counted once; separate workflows with separate implementations count separately. Paths below are repository-relative. Numbers refer to source lines at inspection time.

| # | Category | Confirmed behavior | Source |
|---:|---|---|---|
| 1 | Transport | Main/IPC logger unavailable or throws: console sink | apps/desktop/src/shared/utils/cross-logger.ts:84 |
| 2 | Transport | Structured logger throws: captured original console | apps/desktop/src/backend/logging/console-intercept.ts:89 |
| 3 | Transport | Kick public session fails/challenges: bounded hidden browser request | apps/desktop/src/backend/features/discovery/adapters/kick/channel-endpoints.ts:831 |
| 4 | Provider | Kick official moderation result fails or official IDs absent: legacy mutation helper, shared by four operations | apps/desktop/src/backend/features/moderation/adapters/kick/kick-mod-mutations.ts:93 |
| 5 | Provider | Twitch public identity Helix failure/unavailable: validated GQL | apps/desktop/src/backend/features/discovery/adapters/twitch/twitch-public-profile-reader.ts:102 |
| 6 | Provider | Twitch account creation Helix failure/unavailable: validated GQL | apps/desktop/src/backend/features/discovery/adapters/twitch/twitch-public-profile-reader.ts:127 |
| 7 | Provider | Twitch follow relationship unavailable/error: public GQL; explicit missing scope remains reconnect-required | apps/desktop/src/backend/features/discovery/adapters/twitch/twitch-public-profile-reader.ts:210 |
| 8 | Provider | Twitch public channel resolution Helix unavailable: GQL | apps/desktop/src/backend/features/discovery/adapters/twitch/twitch-public-profile-reader.ts:242 |
| 9 | Provider | Global Twitch badges: direct GQL, persisted GQL, authenticated Helix | apps/desktop/src/backend/features/chat/adapters/twitch/twitch-badge-catalog-provider.ts:90 |
| 10 | Provider | Channel Twitch badges: direct GQL, persisted GQL, authenticated Helix | apps/desktop/src/backend/features/chat/adapters/twitch/twitch-badge-catalog-provider.ts:109 |
| 11 | Provider | Kick broadcaster batch server error: retry smaller batches; remaining server failures skipped | apps/desktop/src/backend/features/discovery/adapters/kick/channel-endpoints.ts:571 |
| 12 | Provider | Unused Twitch ID lookup wrapper: Helix failure/no auth returns empty despite claiming GQL fallback | apps/desktop/src/backend/features/discovery/adapters/twitch/twitch-discovery-reader.ts:147 |
| 13 | Playback/media | Twitch detected ads: clean backup rendition; if unavailable strip/hold unsafe media | apps/desktop/src/frontend/features/playback/adapters/browser/twitch/twitch-adblock-service.ts:724 |
| 14 | Playback/media | Adaptive tier lacks downlink/RTT: effective connection type, otherwise HLS auto | apps/desktop/src/frontend/features/playback/components/player/hooks/use-adaptive-quality.ts:127 |
| 15 | Playback/media | No rendition satisfies target cap: lowest available quality | apps/desktop/src/frontend/features/playback/components/player/hooks/use-adaptive-quality.ts:173 |
| 16 | Playback/media | Recording MP4 finalization fails: preserve output as MPEG-TS | apps/desktop/src/backend/features/media-library/adapters/node/stream-recording-section-finalizer.ts:229 |
| 17 | Cache | Search hydration fills unavailable current result collections from persisted snapshot | apps/desktop/src/frontend/features/discovery/components/hooks/queries/useSearch.ts:922 |
| 18 | Images | Missing/failed/proxy placeholder image: caller fallback or initial | apps/desktop/src/frontend/components/ui/proxied-image.tsx:237 |
| 19 | Images | 7TV image failure: one retry via IPv4 CDN URL | apps/desktop/src/frontend/features/chat/components/chat/official-emote-image-source.ts:72 |
| 20 | Auth | safeStorage unavailable: new token written as base64 | apps/desktop/src/backend/features/authentication/data/authentication-repository.ts:68 |
| 21 | Auth | Unmarked legacy record fails safeStorage decrypt: attempt base64 legacy decode | apps/desktop/src/backend/features/authentication/data/authentication-repository.ts:103 |
| 22 | UI | React region/app exception: recovery view with retry/reload | apps/desktop/src/frontend/features/shell/components/recovery/RecoveryBoundary.tsx:79 |
| 23 | UI | Corrupt/unsupported mobile navigation snapshot: initial state and clear invalid persisted snapshot | apps/mobile/src/features/shell/domain/shell-navigation.ts:481 |

Category counts: transport 3, provider 9, playback/media 4, cache 1, images 2, auth 2, UI 2. Additional reviewed behavior outside this minimum: recording hard-link commit falls back to exclusive copy on specific filesystem errors (stream-recording-section-finalizer.ts:48); retained as useful platform resilience. This illustrates why 23 is a minimum rather than total.

## Actionable candidates, in recommended order

1. **Remove unused Twitch ID-lookup wrapper (#12).** A production `rg -n 'getStreamsByUserIds\(' apps/desktop/src -g '!**/tests/**' finds only this declaration, its direct endpoint invocation, and the endpoint declaration. Wrapper catches Helix errors, logs that it is trying GQL, then returns `{data:[]}`; it never calls GQL. The lower-level typed Helix endpoint is implemented and tested. Remove the dead wrapper and misleading fallback; retain endpoint. Verify reference search, desktop typecheck and stream-endpoints tests. No live provider mutation is needed.

2. **Stop retrying Kick moderation writes after every official rejection (#4).** withOfficialFallback unconditionally calls the legacy writer whenever the official result is not ok. The official implementations exist and their tests pass. First verify each operation's IDs/scopes and documented coverage, then use official-only paths for supported operations; surface explicit failures and avoid retrying uncertain writes. Keep unsupported room-mode operations separate until a supported replacement exists. Add regressions that official forbidden/rate-limited/server results never trigger a second write. Current unit coverage proves implementation behavior, not live authorization success; do not claim this is already safe to delete wholesale.

3. **Remove base64 persistence for newly saved credentials (#20).** The branch is not restricted to development despite its comment. Normal safeStorage encryption exists; fallback produces reversible base64. Verify real safeStorage availability on supported packaging/platforms, implement explicit unavailable behavior before removing this path, and test that unavailable encryption writes no token. Preserve or migrate existing marked/unmarked legacy credentials deliberately (#21); deleting the reader immediately can strand accounts. Existing restart/storage tests are the starting seam, not live cross-platform proof.

4. **Fix Kick batch failure being represented as complete data (#11).** The smaller-batch retry may be necessary provider resilience. The inner catch silently skips a failed sub-batch and returns collected channels without completion metadata. Test a 20-ID server failure followed by one successful and one failed 10-ID request; require an explicit partial/failure result, not inferred offline/absent channels. Only remove the smaller-batch retry after actual provider batch success is demonstrated. This is primarily an error-semantics fix, not a justified wholesale fallback removal.

Keep image placeholders, crash recovery, cache hydration, verified backup playback, diagnostic sinks and recording preservation until evidence shows their primary path can fulfill the same behavior during failures. Successful happy-path tests alone do not make outage handling redundant.

## Verification performed during this inventory

`npx vitest run --project=node src/backend/features/discovery/tests/api/platforms/twitch/stream-endpoints.test.ts src/backend/features/moderation/tests/api/platforms/kick/kick-mod-mutations.test.ts` from apps/desktop: **2 files, 53 tests passed**. Read-only inspection otherwise; no runtime moderation requests, browser actions, or production edits.

## Completed Kick cleanup

Removed the unused banKickUser, timeoutKickUser, unbanKickUser and deleteKickMessage exports, their obsolete input types, numeric-ID coercion and withOfficialFallback helper from moderation/adapters/kick/kick-mod-mutations.ts. Full production name searches found declarations only. Active kick-chat-routes.ts already uses banKickUserOfficial, timeoutKickUserOfficial and unbanKickUserOfficial behind its main credential/sender/input gate. The timeout authority adapter also uses the official implementation. Explicit legacy chatroom operations remain separate; none were silently changed into retries.

Official source rechecked: https://api.kick.com/swagger/doc.yaml, /public/v1/moderation/bans POST/DELETE uses moderation:ban; /public/v1/chat/{message_id} DELETE uses moderation:chat_message:manage. The OpenAPI does not list room-mode updates. No live moderation writes were made.

Migrated retained classification assertions to the active official API. Added parameterized exact-payload success and one-request failure coverage for all three active actions: HTTP 401/403/404/429/500 and ambiguous connection rejection. This is dead-code removal plus hardening of regression coverage; it is not presented as a new active runtime fix. Production request retry/timeouts, scope handling and response classification remain unchanged.

Validation from apps/desktop:
- npx vitest run --project=node src/backend/features/moderation/tests/api/platforms/kick/kick-mod-mutations.test.ts src/backend/features/moderation/tests/api/platforms/kick/kick-timeout-authority-adapter.test.ts src/backend/features/chat/tests/ipc/handlers/kick-chat-handlers.test.ts: 3 files / 64 tests passed.
- npx eslint src/backend/features/moderation/adapters/kick/kick-mod-mutations.ts src/backend/features/moderation/tests/api/platforms/kick/kick-mod-mutations.test.ts: exit 0.
- npx tsc --noEmit: exit 0.

The inventory counts above describe the initial scan; they intentionally remain a dated baseline as cleanup proceeds.
