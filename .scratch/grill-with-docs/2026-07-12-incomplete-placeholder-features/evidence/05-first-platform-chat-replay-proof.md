# First-platform Chat Replay proof

## Automated evidence

- `35` focused tests pass across the Twitch replay source, paginated capability adapter, dense bounded session window, malformed IPC validation, cancellation, bounded cache and in-flight deduplication, narrow playback synchronization boundary, unsupported capability gating, live-chat-store isolation, Twitch VOD playback snapshots, and the Video-page supported path.
- `npm run typecheck` passes.
- `npm run build` passes.
- `npm run lint` passes across all `520` source files.
- The full suite reached `5,103` passing tests. Its only failure was the unrelated Windows real-FFmpeg recording test timing out after `120s`, followed by `EPERM` while cleaning its temporary directory.

## Reviewer follow-up

- Cursor pagination continues until the requested time boundary is covered; a safety-limited partial result is reported as transient rather than supported.
- `comments: null` without a GQL error is classified as unavailable capability/schema drift rather than an empty replay.
- IPC rejects null and malformed payloads before reading request fields.
- An eight-window cache is bounded and seek-friendly; concurrent loads are deduplicated and cancellation reaches the Twitch fetch through IPC and `AbortSignal`.
- Playback snapshots publish into a narrow external-store boundary, so `timeupdate` does not rerender the Video page. The Video test suite runs without replay-introduced `act(...)` warnings.
- Rolling `aria-live` semantics remain explicitly deferred to issues 06/07.

## Electron attempt

Electron MCP opened a real Twitch Video route after restarting the registered StreamFusion development process so the new preload bridge was active.

The attempt discovered that a live Twitch replay response can contain an incomplete badge. The backend logged:

`Chat Replay window unavailable ... Twitch Chat Replay response contained an invalid badge`

A red/green regression test now proves incomplete badges are discarded without discarding the replay window. The focused suite passes after the fix.

The same running Electron session then received concurrent player hot updates and failed with a React Hook-order error in `TwitchVodPlayer`, so a final screenshot and visible-rail assertion could not be captured without another restart. No non-Electron fallback was used.
