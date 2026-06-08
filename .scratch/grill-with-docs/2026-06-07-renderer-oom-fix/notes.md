# Renderer OOM Fix: Grilling Session Notes
Date: 2026-06-07 · Goal: Pin down the design for fixing the renderer OOM TODO at `apps/desktop/src/main.ts:660` — auto-recover + per-renderer telemetry + buffer tuning + per-stream isolation + memory-reduction work. Goal is **maximum stability AND lower memory** simultaneously.

## PRD
Published as GitHub issue #51: https://github.com/TheDarkSkyXD/StreamFusion/issues/51 (label: `ready-for-agent`). GitHub issue is the canonical PRD; this file is the raw grilling audit trail. Implementation tickets published as GitHub issues #52–#60 via `/to-issues`.

## Summary / key decisions

- **Terminology**: `StreamSlot` and `SlotPresence` (`focused | background | hidden`) added to CONTEXT.md; `MultiviewCap` added as the user-configurable cap (default 4, range 1–6).
- **Architecture**: per-StreamSlot `WebContentsView` attached to the main BrowserWindow, rect/z-order/visibility managed from main (ADR-0003).
- **WCV scope**: player only — chat, sidebar, slot chrome all live in the host renderer and overlay each slot's rect.
- **Audio + focus**: only the focused slot emits audio; click or Ctrl+1..6 switches focus.
- **SlotPresence matrix**: `focused` keeps current buffer values; `background` uses user-configurable quality (default ≤480p), 10s forward, 0s back, muted; `hidden` fully tears down its WCV and HLS.
- **Crash policy**: slot crash → auto-retry once within 5-min window, then show retry affordance. Host crash → main auto-reloads host and re-attaches existing WCVs (streams keep playing).
- **Telemetry**: extend the existing 30s process-monitor log line with per-WCV RSS/heap/slotId/SlotPresence/quality via `app.getAppMetrics()`.
- **HLS lifecycle**: detach + re-attach (not destroy + create) when the user changes streams within a slot.
- **Security**: narrow slot-specific preload, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- **Logging**: confirm `web-contents-log-forwarder.ts` handles arbitrary webContents; extend during slice 05 if needed.
- **Migration**: versioned `multistream-store` migration in slice 03 — defaults `MultiviewCap=4`, `BackgroundQuality='auto-low'`.
- **Shipping**: 9 vertical slices, each driven by `/tdd`, each independently shippable. See Q12.

## Q&A log

### Q1 — Term for per-stream render container
- Asked: What do we call the per-stream render container in our glossary?
- Captured: **StreamSlot**. One of N addressable render containers in multiview. Owns its player instance, visibility/focus state, and (after this work) its own renderer process. Distinct from the Stream itself.
- Doc updates: Added `StreamSlot` to CONTEXT.md under Content.
- Flags: none

### Q2 — Naming the focused/background/hidden attribute
- Asked: What do we call the {focused | background | hidden} attribute of a StreamSlot?
- Captured: **SlotPresence**. Three states: `focused` (full quality, full buffer, audio), `background` (degraded quality, trimmed buffer, muted), `hidden` (HLS torn down). One attribute drives quality + buffer + process lifecycle.
- Doc updates: Added `SlotPresence` to CONTEXT.md; updated `StreamSlot` to reference it.
- Flags: none

### Q3 — Isolation mechanism
- Asked: Which Electron isolation primitive hosts each StreamSlot's player?
- Captured: **WebContentsView**. One WCV per slot, attached to the main BrowserWindow, rect/z-order/visibility driven from main via IPC from the React grid. Per-slot `render-process-gone` shows a "stream crashed — retry" affordance in the slot's host shell and rebuilds on user action.
- Rejected: separate BrowserWindow per slot (breaks composited grid), `<webview>` tag (officially discouraged), single-renderer decoder isolation (doesn't contain Chromium native crashes).
- Electron version confirmed: 35.7.5 — BrowserView deprecated, WebContentsView is the supported API.
- Doc updates: ADR-0003 `webcontentsview-per-stream-slot.md` created.
- Flags: none

### Q4 — Multiview cap
- Asked: What's the new multistream cap under the WebContentsView architecture?
- Captured: **User-configurable, default 4, range 1–6**. Replaces the previous hard-coded 6 in `multistream-store.ts:53`. Settings UI exposes a slider with copy explaining the memory trade-off.
- Doc updates: Added `MultiviewCap` to CONTEXT.md; updated `StreamSlot` to reference it.
- Flags: settings UI copy needs drafting (defer to implementation)

### Q5 — Audio + focus routing across isolated slots
- Asked: Audio policy + focus transition trigger.
- Captured:
  - **Audio**: only the focused slot emits sound. Background and hidden are always muted. Main process tracks `focusedSlotId` and broadcasts `mute=true` to all other slots via IPC.
  - **Focus**: single click on a background slot promotes it to focused (prior focused demotes to background). Keyboard shortcut Ctrl+1..6 for fast switching. No hover-to-focus.
- Doc updates: none yet (will fold into SlotPresence behavior section if it grows).
- Flags: none

### Q6 — WebContentsView scope
- Asked: What does each StreamSlot's WebContentsView actually render?
- Captured: **Player only**. Just `<video>` + HLS.js inside each WCV. Chat, stream info, slot chrome (close, settings, focus affordance) all live in the host renderer and overlay the WCV's rect. Chat target follows the focused slot.
- Implication: smallest WCV scope = ~40MB process baseline; simplest IPC contract (slot just needs `loadStream`, `setMute`, `setQuality`, `setBufferConfig`, `unload`).
- Doc updates: none yet.
- Flags: none

### Q7 — SlotPresence behavior matrix
- Asked: Accept matrix or adjust?
- Captured:
  - **focused**: source/user-selected quality, 30s forward buffer, 30s back buffer, audio on, WCV alive + HLS attached.
  - **background**: quality is **user-configurable** (`Auto-low (default ≤480p) | Match source | Off (audio-only)`), 10s forward buffer, 0s back buffer, muted, WCV alive + HLS attached.
  - **hidden**: full teardown — WCV destroyed, HLS torn down, slot state preserved in host renderer for resume.
- Doc updates: none yet (will fold into impl spec).
- Flags: settings UI copy for "Background stream quality" setting → owner: implementer (draft during impl).

### Q8 — Per-process memory telemetry
- Asked: What do we sample, and where does it land?
- Captured:
  - Shape: per-WCV + host, RSS + heap used/total, tagged with `slotId`, `SlotPresence`, current quality. Sampled every 30s using `app.getAppMetrics()` (single call returns all child processes).
  - Sink: extend the existing process-monitor 30s log line with per-slot fields. No new file, no new rotation. Pipes into the existing telemetry sink.
- Doc updates: none yet.
- Flags: none

### Q9 — Auto-recovery on slot crash
- Asked: What happens when a slot's WCV crashes?
- Captured: **Auto-retry once silently within a 5-min window, then show a retry affordance.** First crash: silently rebuild WCV and reload stream. Second crash within the same 5-min window: stop auto-retrying and show "Stream crashed — click to retry" overlay in the slot's host shell chrome (host renderer owns this overlay since slot chrome lives there per Q6).
- Doc updates: none yet.
- Flags: none

### Q10 — Host renderer crash policy
- Asked: What happens when the host renderer crashes?
- Captured: **Auto-reload host, re-attach existing WCVs.** Main process catches host `render-process-gone`, reloads the host URL, and re-attaches the existing slot WCVs (they're owned by main, not by the host). Streams keep playing through host rebuild; user sees a brief chat/sidebar flicker only.
- Implication: WCV ownership lives in main, not in the host renderer. Host has to discover/re-bind to existing slot WCVs on mount via an IPC sync call.
- Doc updates: none yet.
- Flags: none

### Q11 — Closing the loop on original pieces
- Asked: Confirm focused buffer stays put + HLS reuse decision.
- Captured:
  - **Focused slot buffer values stay at current** (30s back / 30s forward / dynamic maxBufferSize). Not additionally lowered. SlotPresence trimming on background/hidden already addresses aggregate memory.
  - **HLS instance reuse within a slot**: when the user changes streams in a slot, `hls.detachMedia()` + `hls.loadSource(newUrl)` + `hls.attachMedia()` instead of destroy + create. Avoids decoder re-init cost.
  - Pooling **across** slots is N/A — different processes, different JS instances.
- Doc updates: none yet.
- Flags: none

### Q12 — Shipping strategy
- Asked: Accept the 9-slice plan, reorder, merge, or split?
- Captured: **Accepted as-is.** 9 vertical slices, each driven by `/tdd` per AGENTS.md, each independently shippable.
  - 01 Auto-recover host renderer on crash
  - 02 Per-process memory telemetry in process-monitor
  - 03 MultiviewCap setting (default 4, range 1–6) + versioned `multistream-store` migration (also folds in `BackgroundQuality='auto-low'` default from Q13)
  - 04 StreamSlot host shell + IPC contract (no WCV yet)
  - 05 Single-slot WCV migration (flagged behind setting) + narrow slot preload (`sandbox: true`, `contextIsolation: true`) + confirm `web-contents-log-forwarder.ts` covers arbitrary webContents
  - 06 All slots WCV + auto-retry-once-then-affordance
  - 07 SlotPresence behavior matrix (quality clamp, buffer trim, hidden teardown, focus/audio routing)
  - 08 Background-quality user setting (settings UI for Q7's dropdown)
  - 09 HLS detach/re-attach on stream change
- Doc updates: none yet (slicing log lives in this file; commit messages will use the `slice NN` convention).
- Flags: none

### Q13 — Completeness backstop
- Asked: preload+security / logging capture / store migration.
- Captured:
  - **Preload + security**: narrow slot-specific `preload/slot.ts` exposing only the slot IPC channels. webPreferences: `{ sandbox: true, contextIsolation: true, nodeIntegration: false }`. Decided now, lands in slice 05.
  - **Logging**: confirm `web-contents-log-forwarder.ts` (from commit c652538) forwards from any webContents, not just the main BrowserWindow. If yes — free. If not — small extension in slice 05.
  - **Store migration**: bump `multistream-store` schema version in slice 03; default `MultiviewCap=4`, `BackgroundQuality='auto-low'`. Add a migration test.
- Doc updates: none.
- Flags: none

## Open flags (pending input)
- Settings UI copy for the MultiviewCap slider → owner: implementer
- Settings UI copy for the Background stream quality setting → owner: implementer
