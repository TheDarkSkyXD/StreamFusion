# Renderer-OOM HITL verification (slices 05 + 06)

Cross-platform dogfood checklist for the WebContentsView-per-StreamSlot
work behind `STREAMFUSION_WEBCONTENTS_VIEW_SLOTS=1`. Sign-off here
unblocks the flag-default flip and the legacy in-process player removal
in `apps/desktop/src/components/multistream/stream-slot.tsx`.

Parent: PRD [#51](https://github.com/TheDarkSkyXD/StreamFusion/issues/51) ·
issues [#56](https://github.com/TheDarkSkyXD/StreamFusion/issues/56) +
[#57](https://github.com/TheDarkSkyXD/StreamFusion/issues/57).

## Setup

```sh
# Windows (PowerShell)
$env:STREAMFUSION_WEBCONTENTS_VIEW_SLOTS = '1'
pnpm --dir apps/desktop dev:mcp

# macOS / Linux
STREAMFUSION_WEBCONTENTS_VIEW_SLOTS=1 pnpm --dir apps/desktop dev:mcp
```

Verify on startup:

- Main-process log shows `[IPC:Bootstrap] WebContentsView-per-slot enabled by env flag`.
- Main-process log shows `[IPC:Slot] Slot-controller IPC handlers registered`.
- Opening DevTools (Ctrl/Cmd+Shift+I) shows the host BrowserWindow — the
  per-slot WCVs are separate webContents and each gets its own DevTools
  attached when you right-click its surface.

## Per-platform checklist

For each of **Windows**, **macOS**, **Linux** repeat the full list.

### Smoke

- [ ] App launches without crashing.
- [ ] Opening one stream (any platform) plays video. The chrome
      (channel badge, mute, chat) renders in the host renderer; the
      video is drawn by the per-slot WCV underneath the chrome.
- [ ] Stream actually plays — no black square, no buffering loop.
- [ ] Resizing the window keeps the WCV pinned under the placeholder
      (no rect drift, no torn z-order, no white flash).

### Multiview

- [ ] Add a second stream. Both play, each in its own WCV process
      (verify in OS task manager: 2× extra Electron Helper (Renderer)
      processes).
- [ ] Click the second tile. It becomes focused (border highlights),
      first tile demotes to background.
- [ ] Only the focused tile emits audio. Background tile auto-mutes.
- [ ] Switch focus back. Audio + buffer config (set-quality →
      auto-low) re-applies.
- [ ] Ctrl+1 focuses tile 1, Ctrl+2 focuses tile 2. Ctrl+Shift+1
      does NOT focus (modifier guard).
- [ ] Open 4–6 streams in grid layout. Each WCV stays pinned to its
      grid cell on every resize / drag / focus change.

### Background-quality setting

- [ ] Settings → Multiview → Background-stream quality dropdown:
      switch to "match-source" while background streams are running.
      Watch DevTools for each WCV's slot-renderer console — should
      reflect a setQuality event.
- [ ] Switch to "off". Background streams stop video, audio stays
      muted, slot chrome still updates.
- [ ] Switch back to "auto-low". Background streams resume at clamped
      quality.

### Crash recovery

- [ ] Force-crash a slot WCV: right-click the slot → "Inspect Element"
      → in DevTools console run `process.crash()`. The slot silently
      rebuilds + reloads the stream (first crash within 5-min window).
- [ ] Force-crash the same slot a second time within the window. The
      "Stream crashed — click to retry" overlay appears in the slot
      chrome.
- [ ] Click "Click to retry". The WCV rebuilds and the stream replays.
- [ ] Force-crash the host BrowserWindow (DevTools console of the
      MAIN window: `process.crash()`). The host reloads; the slot
      WCVs keep playing through the host rebuild; chat/sidebar
      flickers briefly then re-renders.

### Memory

- [ ] Resident memory (`Task Manager` / `Activity Monitor` /
      `htop`) for the helper processes is reasonable at idle (the
      4-stream baseline is ~40–80 MB per helper per ADR-0003).
- [ ] After 30 minutes of one focused + three background streams,
      RSS for the host renderer stays under ~600 MB. Background WCVs
      stay under ~150 MB each.

### Lifecycle

- [ ] Close a stream tile. The WCV is destroyed; the Electron helper
      process count drops by one.
- [ ] Quit the app. All helper processes exit within ~3 s (the
      before-quit hard-kill window).

## Sign-off

When all platforms pass:

1. Flip the default in `apps/desktop/src/backend/api/unified/slot-controller.ts`:
   ```ts
   let useWebContentsViews = true; // was: false
   ```
2. Remove the env-var fall-back in
   `apps/desktop/src/backend/ipc-handlers.ts` (no longer needed).
3. Delete the legacy in-process player render path from
   `apps/desktop/src/components/multistream/stream-slot.tsx` — the
   `wcvEnabled` branch becomes the only branch; drop the
   `KickLivePlayer` / `TwitchLivePlayer` imports + lazy-mount + stagger
   constants that exist only to bound the in-process HLS init cost
   the WCV path doesn't have.
4. Close issues #56 + #57 referencing this doc.

## Rollback

If anything breaks badly on any platform, unset the env var and the
app reverts to the legacy in-process player path with no other
changes needed. The flag is the only switch.
