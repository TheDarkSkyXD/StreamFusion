# Guest public-read gate audit, 2026-09-06

Bounded desktop audit completed without production edits. No additional verified public-read sign-in block was found outside the Twitch category video/clip work owned by renderer_integration_review. This is source inspection plus deterministic tests, not a claim that every provider response or live guest account permutation has been exercised.

## Covered paths

- Navigation: frontend/routes/router.tsx registers home, following, categories/detail, search, stream, video, multistream, history and downloads without auth beforeLoad guards. App.tsx and shell/components/layout/AppLayout.tsx do not add an account gate to these routes. Moderation routes have separate authority requirements.
- Discovery search: backend/features/discovery/routes/search-routes.ts:132 and :307 pass public Twitch/Kick channel results through when unauthenticated; they skip authenticated enrichment rather than deny search. TwitchDiscovery.searchChannels/searchCategories chooses public GQL for guests.
- Channel lookup: discovery/routes/channel-routes.ts reads public channel identity. CHANNELS_GET_FOLLOWED is explicitly the remote-follow read; its Twitch account check does not gate local-follow UI. ID-only authenticated reader methods are not the guest channel-login path.
- Following: frontend/features/discovery/components/screens/Following/index.tsx waits for auth initialization and local-follow hydration, not a connected account. Its connected flags are for sync status. backend discovery/routes/stream-routes.ts reads local Twitch follows via getStreamsByLogins and local Kick follows independently of remote account reads. Logged-in remote follow reads remain account-required.
- Watch: playback/routes/stream-playback-routes.ts has no account gate. Twitch stream-resolver uses provider-issued public playback access tokens, which are distinct from a user's OAuth token; live/VOD/clip source resolution does not require signing in. Channel video/clip routes use public GQL. Frontend Stream and Video screens have no sign-in guard. Public media can still be unavailable/restricted by the provider; no bypass is added.
- MultiView: multistream screen, stream-slot and add-stream-dialog do not gate reading/searching/playing public streams on account state. Slots use the same public resolution contracts.
- Downloads/history: media-library components/routes/adapters and download-media-source policy do not introduce an account gate. Download source validation and local save-file permissions remain required. No actual download or local-file mutation was performed for this audit.
- Auth gating helper: GuestMode.tsx enumerates account features (chat sends/moderation/platform follows/etc.); no active FeatureGate/LoginPrompt consumer was found outside that module. It is not blocking these public pages.

## Deliberately preserved

Remote followed-account synchronization, account writes, chat sends/moderation and provider-private data retain their account/scopes requirements. Existing diagnostic/cache/partial-result behavior was not replaced with invented success or authentication fallbacks. Category public-read files and auth storage were not edited.

## Verification

From apps/desktop:

`npx vitest run --project=node src/backend/features/discovery/tests/ipc/handlers/search-handlers.test.ts src/backend/features/discovery/tests/ipc/handlers/stream-handlers.test.ts src/backend/features/discovery/tests/ipc/handlers/channel-handlers.test.ts src/backend/features/playback/tests/api/platforms/twitch/twitch-stream-resolver.test.ts src/backend/features/playback/tests/api/platforms/kick/kick-stream-resolver.test.ts src/backend/features/media-library/tests/ipc/handlers/download-handlers.test.ts`

6 suites, 158 tests passed.

`npx vitest run --project=dom src/frontend/features/discovery/tests/pages/Following.test.tsx src/frontend/features/discovery/tests/hooks/queries/useStreams.test.tsx src/frontend/features/multistream/tests/pages/MultiStream.test.tsx src/frontend/features/multistream/tests/components/multistream/add-stream-dialog.test.tsx src/frontend/features/discovery/tests/components/ui/follow-button.test.tsx`

5 suites, 92 tests passed.

Total: 11 suites / 250 tests. These are relevant existing suites containing broader behavior checks as well as guest scenarios; 250 is not presented as 250 distinct guest scenarios. No browser automation, live mutations, commits, or source changes.
