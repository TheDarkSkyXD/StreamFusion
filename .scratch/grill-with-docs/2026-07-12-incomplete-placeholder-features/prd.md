# Chat Replay and Subtitles/CC

## Problem Statement

The Video page permanently renders a non-functional Chat Replay rail, and the player settings menu permanently renders a disabled Subtitles/CC row. These controls advertise capabilities StreamFusion does not currently provide, consume space, and make the product feel unfinished.

The word `placeholder` also appears in several unrelated contexts. Some are legitimate input hints, loading skeletons, cached-data states, or image fallbacks and must remain. Others are misleading scaffolding comments or documentation and should be replaced with precise language rather than treated as features.

## Solution

Deliver Chat Replay and Subtitles/CC as one product milestone with independent release gates.

Chat Replay becomes a capability-gated, read-only historical chat rail synchronized to Video playback. It may launch for one Platform before the other, but only after engineering proves a reliable Platform-owned first-party replay source. Unsupported Videos do not render the rail.

Subtitles/CC becomes a capability-gated player feature for any Stream or Video whose active media exposes a Timed Text Track. StreamFusion renders cues in a custom overlay, with a native Chromium handoff only while native Picture-in-Picture is active.

Cleanup removes unused scaffold references and replaces vague `placeholder` terminology with the actual state being represented. Legitimate placeholders remain.

## User Stories

### Chat Replay

- As a viewer watching a supported Video, I can see historical chat messages appear at their original playback offsets.
- As a viewer who pauses, seeks, or changes playback speed, I see replay timing remain synchronized with the Video.
- As a viewer, I can scroll through replay history without pausing the Video, then use a time-labelled return control to resume auto-follow at the current playback position.
- As a viewer, I can click a message timestamp to seek the Video to that message without making the entire message an accidental seek target.
- As a viewer, I can see badges, emotes, mentions, links, and lightweight user details, but I cannot send messages or invoke moderation actions from historical chat.
- As a viewer on desktop, I can collapse the right rail; at narrower window sizes, I can open the same replay experience in a drawer.
- As a viewer, I see distinct loading, retryable failure, supported-but-empty, and unsupported outcomes.

### Subtitles/CC

- As a viewer, I see Subtitles/CC in player settings only when the active Stream or Video exposes at least one valid Timed Text Track.
- As a viewer, I can turn captions Off or select any available language track.
- As a viewer, my enabled state and preferred language persist globally. When the preferred language is absent, captions stay Off rather than silently selecting a different language.
- As a viewer, I can adjust caption text size and background opacity and reset both values to accessible defaults.
- As a viewer, I see valid cue positioning and alignment honored; cues without usable positioning appear bottom-center and clear visible controls.
- As a viewer entering native Picture-in-Picture, I continue to receive the selected captions through Chromium's native renderer; StreamFusion's overlay resumes when I exit PiP.
- As a viewer, a caption-track failure does not interrupt media playback. Captions turn Off and the captions menu offers Retry.

## Implementation Decisions

### Chat Replay

- Begin with a feasibility proof, not UI implementation. For each candidate Platform source, verify availability by Video ID, pagination/cursors, stable message offsets, message fidelity, deletion behavior, authentication needs, rate limits, and representative failure responses.
- Permit undocumented Platform-owned first-party web endpoints behind a narrow replaceable capability adapter. Do not use community archives and do not record or retain live chat locally for later replay.
- Enable the capability independently per Platform and Video. Absence of a supported source is not an error and removes the rail entirely.
- Normalize provider data into a Platform-neutral replay-message model containing a stable message ID, Video offset, sender presentation, badges, and content fragments.
- Keep replay data session-scoped and bounded. Fetch/cache windows around playback time rather than loading an entire multi-hour chat into memory.
- Expose VOD playback time, pause/playing state, seeks, and rate changes through a player-level contract usable by the Video page and replay controller.
- Seeking rebuilds the visible replay window around the destination. Normal playback appends messages as their offsets become current.
- Scrolling suspends only rail auto-follow. The return control is labelled with the current Video time and restores synchronization.
- Use a replay-specific read-only presentation boundary. Do not feed historical messages into the live `channelKey` chat store or expose live sending/moderation controls.
- Use the selected collapsible-right-rail layout on desktop and a drawer for narrower windows. Final dimensions and breakpoints follow `DESIGN.md`.

### Subtitles/CC

- Use HLS.js 1.6.15 track discovery/update events and its subtitle/caption selection APIs. Do not infer availability from the disabled menu stub.
- Extend the player contract with available Timed Text Tracks, selected track, selection callback, display state, cue updates, and non-fatal track errors.
- Hide the settings row when no valid track exists. When tracks exist, show an Off option and all available languages in a dedicated submenu.
- Persist `{ enabled, preferredLanguage, textSize, backgroundOpacity }` with the existing global player preferences. Match the preferred language when present; otherwise remain Off.
- Render active cues in a StreamFusion-owned overlay as established by ADR-0009. Preserve valid WebVTT positioning/alignment and apply a control-safe bottom-center fallback.
- First-release style controls are text size, background opacity, and Reset. Font and foreground color remain fixed accessible defaults. Do not add a keyboard shortcut.
- On native PiP entry, disable the custom overlay and expose the selected native text track to Chromium. Restore custom rendering on PiP exit. Native PiP styling is allowed to differ from in-app styling.
- Treat subtitle load errors as non-fatal: keep media playing, set captions Off, retain the failed selection for Retry, and show the error only in the captions submenu/non-blocking notification surface.

### Cleanup

- Remove the disabled Subtitles/CC stub and the permanent unsupported Chat Replay panel as their real capability-gated surfaces replace them.
- Remove documentation claims that empty component directories are future features when there is no defined product requirement.
- Rename the Twitch badge-parser comment from `Placeholder` to an explicit unresolved-until-`BadgeResolver` state; the existing two-stage resolution is intentional.
- Preserve input `placeholder` attributes, loading skeletons, React Query placeholder data, proxy image fallbacks, multiview host surfaces, and other intentional states.

### Delivery

- Track Chat Replay and Subtitles/CC in one milestone, but allow separate releases.
- Subtitles/CC may ship as soon as its acceptance criteria pass.
- Chat Replay cannot enter implementation until the feasibility proof succeeds for at least one Platform. A second Platform may follow later without blocking the first.

## Testing Decisions

### Chat Replay acceptance

- Unit-test each provider normalizer and capability classification with recorded, redacted fixtures.
- Test time-window selection at start, middle, end, pause, forward seek, backward seek, and non-1× playback rates.
- Test that scrolling suspends auto-follow without pausing playback and that the return control restores the correct current window.
- Test timestamp-only seeking and verify links/user interactions do not seek.
- Test loading, retryable error, empty, unsupported, and source-capability-loss states.
- Test bounded memory/cache behavior on representative multi-hour replay data.
- Verify the responsive rail/drawer and read-only interaction boundary in the running Electron app.

### Subtitles/CC acceptance

- Unit-test track discovery, track updates, Off/language selection, preferred-language restoration, and unavailable-language fallback.
- Test single-line, multi-line, overlapping, positioned, malformed-position, and rapid cue transitions.
- Test text-size/background-opacity preferences and Reset with accessible default contrast.
- Test control visibility, fullscreen, resize, and narrow player bounds so captions remain readable and do not cover controls unnecessarily.
- Test track-load failure and Retry without stopping or remounting media playback.
- Test native PiP entry/exit handoff and restoration of the custom overlay in Electron.
- Verify Streams and Videos from both Platforms hide the menu when no tracks exist and expose it when tracks do exist.

### Quality gates

- Run focused unit/component tests during TDD, then the complete relevant test suites.
- Run lint, type-check, and production build with zero errors.
- Run `/deslop` on the implementation diff.
- Verify all UI behavior in the running StreamFusion app using Electron MCP only.

## Out of Scope

- Requiring Twitch/Kick Chat Replay parity in the first Chat Replay release.
- Community historical-chat services or long-term local chat recording.
- Sending chat messages or performing moderation from Chat Replay.
- A full chat transcript independent of playback.
- Caption translation, speech-to-text generation, or captions for media without a supplied Timed Text Track.
- Caption keyboard shortcuts, draggable captions, and a full font/color/edge-style editor.
- Matching custom caption styling inside native Picture-in-Picture.
- Turning empty component scaffolds, Downloads mock data, Whisper, room-state TODOs, or seek-preview TODOs into features in this milestone.
- Removing legitimate placeholder attributes, skeletons, cached-data states, or image fallbacks.

## Further Notes

- Selected Chat Replay layout: [designs/chat-replay-layout.html](./designs/chat-replay-layout.html), Option A.
- Selected caption rendering direction: [designs/caption-rendering.html](./designs/caption-rendering.html), Option B.
- Domain terms are recorded in [`CONTEXT.md`](../../../CONTEXT.md): Chat Replay and Timed Text Track.
- Caption renderer ownership is recorded in [`docs/adr/0009-custom-caption-rendering.md`](../../../docs/adr/0009-custom-caption-rendering.md).
- Twitch's official embed documentation states that its VOD embed does not support chat replay: <https://dev.twitch.tv/docs/embed/everything/>.
- Kick's official public API currently exposes chat send/delete operations but no historical-chat read endpoint: <https://api.kick.com/swagger/index.html>.
