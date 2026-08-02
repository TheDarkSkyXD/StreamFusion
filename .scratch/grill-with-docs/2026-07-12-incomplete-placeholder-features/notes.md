# Incomplete Placeholder Features: Grilling Session Notes
Date: 2026-07-12 · Goal: Decide whether each apparent placeholder should be built, removed, or retained, and define the user-facing behavior for work that should ship.

## PRD

- [Chat Replay and Subtitles/CC PRD](./prd.md)

## Summary / key decisions

- Code review separated genuine user-facing stubs from intentional internal placeholder states.
- Visual mockups are enabled for layout and interaction decisions where seeing options is more useful than text alone.
- Feature scope is Chat Replay and Subtitles/CC. Empty scaffolding and misleading comments will receive a cleanup decision, not be treated as product features.
- Chat Replay will be capability-gated: it may ship per Platform/Video, and the rail is absent when replay data is unavailable.
- Chat Replay is driven by Video playback time: pause freezes message arrival, seek rebuilds the visible window, and playback speed changes replay timing.
- Viewers may scroll through replay history without pausing the Video. Scrolling suspends rail auto-follow until they explicitly return to the current playback time.
- Each replay message has a small timestamp control; clicking the timestamp seeks the Video, while the rest of the message retains normal interactions.
- Chat Replay uses a collapsible right rail on desktop and a drawer at narrower window sizes.
- Chat Replay is read-only: preserve message presentation and safe content interactions, but exclude sending and moderation actions.
- Chat Replay distinguishes loading, transient failure, empty history, and unsupported capability states; only the unsupported state removes the rail.
- Chat Replay may use Platform-owned first-party web endpoints behind replaceable adapters, even when undocumented. It will not depend on community archives or collect long-term local chat history.
- Subtitles/CC is capability-gated for both live Streams and Videos on either Platform; its menu exists only when the active media exposes at least one valid timed text track.
- Caption enablement and preferred language persist globally. A new media item uses the preferred language when available and otherwise leaves captions Off.
- StreamFusion will render timed text in its own overlay instead of delegating cue presentation to Chromium's native renderer.
- First-release caption customization is limited to text size, background opacity, and Reset; typography and colors remain accessible fixed defaults.
- The custom renderer honors valid cue positioning/alignment and otherwise uses a bottom-center safe area that clears visible player controls.
- Native Picture-in-Picture temporarily uses Chromium's caption renderer for the selected track; the custom overlay resumes on exit.
- Subtitles/CC is controlled through the player settings menu only; the first release adds no caption keyboard shortcut.
- Caption-track failures never stop Video playback: captions turn Off and the menu shows a non-blocking error with Retry.
- Cleanup is semantic, not keyword-driven: remove unused scaffold references and rename vague intermediate states, while preserving legitimate input hints, loading skeletons, and image fallbacks.
- Chat Replay and Subtitles/CC belong to one milestone but may ship in separate releases. Subtitles/CC is not blocked by Chat Replay source feasibility.

## Q&A log

### Q1 — Visual decision support
- Asked: Should the grill use visual mockups when layout matters, or remain text-only?
- Captured: Use visual mockups when layout matters.
- Doc updates: none
- Flags: none

### Q2 — Grill scope
- Asked: Should the grill focus on genuine user-facing stubs, all four originally identified items, or expand into a repository-wide unfinished-feature audit?
- Captured: Focus on Chat Replay and Subtitles/CC; separately decide whether misleading scaffolding/comments should be deleted.
- Doc updates: none
- Flags: none

### Q3 — Chat Replay platform rollout
- Asked: Must Chat Replay launch on Twitch and Kick simultaneously, or may it ship where reliable replay data exists?
- Captured: Use a capability-gated rollout. Ship per Platform/Video when supported and hide the rail when unavailable.
- Doc updates: added the Chat Replay term to `CONTEXT.md`
- Flags: identify reliable historical-chat sources per Platform

### Q4 — Chat Replay synchronization
- Asked: Should Chat Replay be driven by playback time, be an independent transcript, or only provide message-to-video seeking?
- Captured: Use true playback synchronization. Messages follow their original Video offsets; pause, seek, and playback speed all affect the replay timeline.
- Doc updates: none; this behavior is consistent with the existing `CONTEXT.md` definition
- Flags: none

### Q5 — Browsing away from playback time
- Asked: May viewers scroll away from the synchronized message position, and should that affect Video playback?
- Captured: Reuse the live-chat interaction. Scrolling pauses rail auto-follow but leaves the Video playing; a time-labelled return control resynchronizes the rail.
- Doc updates: none
- Flags: exact return-control copy and placement will be handled in the visual layout decision

### Q6 — Message-to-Video seeking
- Asked: Should replay messages seek the Video, and what click target should perform the seek?
- Captured: Show a timestamp on every replay message. Clicking only the timestamp seeks the Video to that message's offset.
- Doc updates: none
- Flags: none

### Q7 — Chat Replay placement
- Asked: Should Chat Replay use a right rail, a panel below the Video, or an on-demand overlay?
- Captured: Use a collapsible right rail on desktop and a drawer on smaller windows.
- Doc updates: none
- Flags: responsive breakpoint and exact rail sizing should follow `DESIGN.md` during implementation
- Visual: `designs/chat-replay-layout.html` (Option A selected)

### Q8 — Replay message interactions
- Asked: Should replay messages offer full live-chat interactions, safe read-only interactions, or plain text only?
- Captured: Use read-only replay. Preserve badges, emotes, mentions, links, and lightweight user details; disable sending and moderation actions.
- Doc updates: none
- Flags: define the lightweight historical-user detail surface during implementation without reusing live moderation controls

### Q9 — Replay availability states
- Asked: How should the rail behave while loading, after transient failure, with zero messages, or when replay is unsupported?
- Captured: Show a skeleton while loading, inline retry for transient failure, an empty state for a supported replay with no messages, and hide the rail only when replay is unsupported.
- Doc updates: none
- Flags: none

### Q10 — Replay data-source policy
- Asked: Given the lack of official historical-chat endpoints, may StreamFusion use undocumented first-party endpoints, only documented APIs, or third-party/local archives?
- Captured: Allow Platform-owned first-party web endpoints behind replaceable adapters. Do not use community archives or local long-term chat collection.
- Evidence: Twitch's official embed documentation says VOD chat replay is unsupported; Kick's official public API exposes chat send/delete but no historical read endpoint.
- Doc updates: none; this is a feature implementation constraint, not glossary material or an ADR-worthy irreversible decision
- Flags: verify a reliable first-party replay source independently for each Platform before enabling its capability

### Q11 — Subtitles/CC availability
- Asked: Should Subtitles/CC apply to all media with tracks, Videos only, or remain visibly disabled without tracks?
- Captured: Make it capability-gated for Streams and Videos on either Platform. Show the menu only when the active media exposes at least one valid track.
- Evidence: the installed HLS.js 1.6.15 engine exposes subtitle/caption tracks, selection, display toggling, and track-update events.
- Doc updates: added the Timed Text Track term to `CONTEXT.md`
- Flags: none

### Q12 — Caption preference persistence
- Asked: Should caption enablement/language persist, reset Off for every media item, or automatically follow the app language?
- Captured: Persist caption enablement and preferred language globally. Reuse that language when available; otherwise fall back to Off.
- Doc updates: none
- Flags: none

### Q13 — Caption renderer ownership
- Asked: Should timed text use the native media renderer or a custom StreamFusion overlay?
- Captured: Use a custom StreamFusion overlay.
- Doc updates: created `docs/adr/0009-custom-caption-rendering.md`
- Flags: define the first-release customization controls and accessibility acceptance criteria
- Visual: `designs/caption-rendering.html` (Option B selected)

### Q14 — First-release caption customization
- Asked: Should the first release have a fixed style, essential controls, or a full caption-style editor?
- Captured: Provide text size, background opacity, and Reset. Keep font and colors as accessible fixed defaults.
- Doc updates: none
- Flags: none

### Q15 — Caption cue positioning
- Asked: Should StreamFusion honor cue positioning, force bottom-center placement, or make captions draggable?
- Captured: Honor valid positioning and alignment metadata. Fall back to a bottom-center safe area that moves above visible controls.
- Doc updates: none
- Flags: none

### Q16 — Native Picture-in-Picture captions
- Asked: Since a DOM overlay cannot enter native PiP, should captions use a native fallback, be unavailable, or block PiP?
- Captured: Use the custom overlay in-app and temporarily hand the selected track to Chromium's native caption renderer while native PiP is active.
- Doc updates: amended ADR-0009 to record the native PiP exception
- Flags: native PiP cannot guarantee the custom overlay's style preferences

### Q17 — Caption keyboard shortcut
- Asked: Should captions use the `C` key, be menu-only, or add a configurable shortcut immediately?
- Captured: Use the player settings menu only.
- Doc updates: none
- Flags: none

### Q18 — Caption-track failure
- Asked: Should a selected-track failure be non-fatal with Retry, silently auto-retry, or stop playback?
- Captured: Keep playback running, turn captions Off, and expose a non-blocking error with Retry in the captions menu.
- Doc updates: none
- Flags: none

### Q19 — Placeholder cleanup boundary
- Asked: Should cleanup target misleading scaffolding, preserve existing comments, or remove every occurrence of the word `placeholder`?
- Captured: Remove unused scaffold references and rename intentional intermediate states precisely. Preserve legitimate input hints, skeletons, and image fallbacks.
- Doc updates: none
- Flags: inventory exact cleanup edits when implementation issues are produced

### Q20 — Delivery sequencing
- Asked: Should the features ship together, Subtitles/CC first, or Chat Replay first?
- Captured: Initially requested one release; clarified in Q21 as one milestone with separate releases.
- Doc updates: none
- Flags: Chat Replay still requires a feasibility proof covering source stability, pagination, time offsets, message fidelity, and failure behavior.

### Q21 — Combined release gate
- Asked: Does one release mean a hard gate, development behind a disabled flag, or one milestone with separate releases?
- Captured: Use one milestone with separate releases. Subtitles/CC may ship before Chat Replay.
- Doc updates: none
- Flags: none

### Q22 — Completeness check
- Asked: Are the product decisions complete, or should either feature be revisited?
- Captured: Product decisions are complete; close the grill and produce the local PRD.
- Doc updates: reconciled session notes and created `prd.md`
- Flags: none

## Open flags (pending input)

- Prove a stable first-party Chat Replay source for at least one Platform before implementation -> engineering
- Validate custom caption-overlay accessibility and native PiP handoff in Electron -> engineering / QA
