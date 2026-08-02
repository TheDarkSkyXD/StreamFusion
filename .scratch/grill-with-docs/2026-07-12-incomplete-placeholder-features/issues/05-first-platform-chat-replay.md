# Deliver synchronized Chat Replay for the first proven Platform

Status: done
Type: AFK

## Parent

[Chat Replay and Subtitles/CC PRD](../prd.md)

## What to build

Deliver a narrow, complete Chat Replay path for the first Platform proven by the feasibility issue. Fetch bounded windows of normalized historical messages for a Video, synchronize them to pause/seek/rate-aware playback time, and render a capability-gated read-only rail only for supported Videos.

## Acceptance criteria

- [ ] A supported Video loads normalized replay messages through a replaceable Platform capability adapter.
- [ ] Replay data is session-scoped and bounded around playback time rather than loading an entire Video history.
- [ ] Normal playback, pause, forward/backward seek, and non-1× rates produce the correct visible message window.
- [ ] Unsupported Videos render no rail and do not report an error.
- [ ] The implementation does not write replay messages into the live `channelKey` chat store.
- [ ] Automated tests and Electron verification demonstrate the end-to-end supported-Video path.

## Blocked by

- [01-prove-chat-replay-source.md](./01-prove-chat-replay-source.md)

## Comments

- Implemented Twitch first-party replay through validated IPC, preload, a paginated/cancellable service, bounded renderer cache, and capability-gated Video integration without writing into the live chat store.
- Reviewer follow-up added dense cursor coverage, malformed-payload validation, cancellation, in-flight deduplication, and playback-store isolation. Focused tests, lint, type-check, and build passed.
- Electron proof on Video `2817099532` rendered a visible replay rail with 293 historical messages. Evidence: `.scratch/images/chat-replay-proof.png`.
