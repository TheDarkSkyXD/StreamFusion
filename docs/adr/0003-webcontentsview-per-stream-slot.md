# Host each StreamSlot in its own WebContentsView

The single-renderer multiview architecture (up to 6 HLS.js instances co-resident in one BrowserWindow's renderer process) couples StreamSlot stability: a Chromium video-decoder crash, an HLS.js bug, or a memory exhaustion in any one slot kills the entire UI — chat, sidebar, sibling streams, all gone. The renderer-OOM TODO at `apps/desktop/src/main.ts:660` was sitting on this premise and the on-disk logs caught it happening (`[Main] Renderer was OOM killed`).

We're moving each StreamSlot into its own `WebContentsView` attached to the main BrowserWindow, with rect/z-order/visibility managed from the main process and driven by the React grid via IPC. WebContentsView (Electron 30+) replaces the deprecated `BrowserView`; it gives each slot its own renderer process (V8 isolate, GPU context, network service binding), so a single slot's crash is contained — the rest of the UI and sibling streams survive. Each WCV's `render-process-gone` is handled in main: the slot's host shell shows a "stream crashed — retry" affordance and rebuilds the WCV on user action, no app-wide reload.

Considered and rejected:
- **Separate BrowserWindow per slot.** Trivially isolated but breaks the composited multiview grid: multiple taskbar entries, per-window window-control chrome, no shared focus/audio routing, hostile to the Dark Theater design language.
- **`<webview>` tag.** Officially discouraged for new Electron code ("stability and security issues"); worse process model and lifecycle than WCV.
- **Single renderer, isolate decoder only** (Workers, OffscreenCanvas, AudioWorklet). Cheaper but does not contain a Chromium native decoder crash, which is the failure mode the TODO calls out.

Reversal cost is meaningful: switching primitives later forces another rewrite of the slot host shell, IPC contract, focus/audio routing, and rect/z-order management. The choice is load-bearing because per-process memory overhead (40–80MB × N slots) is the cost we accept in exchange for crash containment — the memory-reduction work (SlotPresence-driven suspend, quality scaling, lower multiview cap) exists specifically to absorb this baseline tax.
