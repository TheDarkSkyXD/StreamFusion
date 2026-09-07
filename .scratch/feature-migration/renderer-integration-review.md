# Renderer integration review

Baseline is HEAD 9ef8251. Initial read-only review of the migration working tree, followed by explicitly assigned badge-port and Twitch-command fixes.

## Follow-up status

- Finding 1 is resolved. Rechecked the relocated auth/shell hooks and extracted domain shutdown registry. Registration identity cleanup, notification navigation, hook unsubscription, synchronous errors, and promise rejection handling preserve the old behavior.
- Finding 2 is resolved. The port now returns normalized ChatBadgeAssignment arrays and ChatRoleBadges. The adapter owns provider decoding and URL normalization. Existing TwitchChat tests and three focused adapter tests passed, 53 total. Root is tightening the getter's optional return contract and affected consumers.
- Root owns finding 3 and the renderer service test migration.
- Root also assigned the remaining Twitch API command extraction. The shared executor is now 51 lines of dispatch and error mapping. Chat owns settings, pins, and slash execution; moderation owns moderation commands and user blocking; discovery owns public user lookup; authentication owns signed-in command actor lookup. Chat domain owns slash target selection and broadcaster-identity authorization. Shared transport owns query construction and response decoding. The 31 existing command and IPC tests passed after final extraction. Focused ESLint and feature boundary proofs passed. AST comparison confirms all 21 extracted ordinary command branches and the slash-action switch are unchanged, recorded in twitch-command-extraction-parity.json.

## Findings

1. P2, responsibility placement. `frontend/features/auth/composition/live-notification-bridge.ts:15` implements a React effect, mutates notification state, renders a toast, and navigates. `frontend/features/shell/composition/app-shutdown.ts:15` implements a React lifecycle hook and shutdown behavior. `app-shutdown-registry.ts` implements mutable task registration and execution policy. The required structure assigns presentation hooks to components and reserves composition for dependency wiring. Root accepted this finding and is moving the hooks and separating registry policy.

2. P2, provider normalization. `frontend/features/chat/capabilities/chat-presentation-services.ts:2-11` exposes BTTVBadgeCatalog, FFZBadgeCatalog, and FFZRoomResponse. `components/chat/twitch/TwitchChat.tsx:613-629`, `642-658`, and `682-703` still map vendor payloads into application badge assignments, including FFZ size-keyed URLs, room.mod_urls, and room.vip_badge. This does not satisfy the provider-neutral port requirement. Adapters should return the application's normalized badge assignment and role badge shapes.

3. P2, ownership. Twenty-five files under `backend/features/chat/tests/` reference the moved frontend chat implementations. They include Kick/Twitch services, chat parsers, pin polling, predictions, cosmetics, and emote service tests. They should follow the renderer feature that now owns their subject. Find candidates with `rg -l 'frontend/features/chat|@/features/chat/(adapters|domain|composition)' apps/desktop/src/backend/features/chat/tests`; inspect cross-feature integration exceptions individually.

## Behavior checks

- No concrete new behavior regression found in the reviewed renderer changes.
- Compared both HLS lifecycle effect bodies against HEAD using TypeScript AST extraction. Differences are formatting, injected bufferPreferences, and the extracted playlistProxySourceId field. Startup, recovery, HLS listeners, media cleanup, and effect dependency arrays retain their behavior. Scratch before/after artifacts are `review-generic-{before,after}.txt` and `review-twitch-{before,after}.txt`.
- Compared KickChatService and TwitchChatService bodies against original `backend/services/chat` files. The only substantive changes are lifecycle injection and replacement of all five original store eviction calls with the lifecycle port.
- KickChat, TwitchChat, multichat sessions, message router, dev simulation, and the lazy loader import composition modules that wire lifecycle before service use.
- Remaining raw singleton consumers only publish events, observe transport, or acquire/connect/release the shared raid transport. None introduces joined chat buckets before lifecycle wiring.
- Emote provider initialization remains explicitly lazy. Loader promises and loaded-module tracking remain present.
- Diagnostics counters, immediate first report, one-second diagnostics reporting, thirty-second activity reporting, animation-frame cancellation, and timer teardown match the original implementations.
- Reviewed extracted updater, discovery, recording/download, auth, and chat bridge operations. Arguments and subscription cleanup remain present. The service eviction test assertions are preserved and constructors explicitly receive chatChannelLifecycle.

## Review limits

No fresh test run or app launch was performed in this review. Root is running the integrated suite. The scratch renderer-review-diff.json is a triage aid, not an exact diff; its import filtering ignores import-only changes and its initial move map does not connect all historic backend service paths.

Minimize Reader Load directed the review to trace actual singleton entry points and mutable lifecycle state. Type System Discipline directed the port review to inspect the payload types exposed to components.
