/**
 * Slot WebContentsView renderer entrypoint. Slice 05 of the renderer-OOM
 * PRD (#51). Minimal vanilla-TS bootstrap — NOT React, NOT the main app.
 *
 * Each StreamSlot's WCV loads this page. The script wires:
 *   - `window.slotAPI.onLoadStream` → HLS.js attach + loadSource
 *   - `window.slotAPI.onSetMute`    → video.muted = muted
 *   - `window.slotAPI.onUnload`     → tear down HLS + clear video element
 *   - playback events → window.slotAPI.reportPlaybackEvent (for the host
 *     and slice 07's presence matrix later)
 *
 * The host renderer (chat, sidebar, slot chrome) lives unchanged in the
 * main BrowserWindow and is overlaid on top of each WCV's rect, driven
 * from main per ADR-0003.
 */

import Hls from "hls.js";

import type { SlotAPI } from "../../backend/preload/slot";

declare global {
  interface Window {
    slotAPI?: SlotAPI;
  }
}

const videoEl = document.getElementById("player") as HTMLVideoElement | null;
if (!videoEl) {
  // The HTML guarantees the element exists; this is purely a defensive
  // typeguard so the rest of the file can treat `video` as non-null.
  throw new Error("slot-renderer: <video> element missing");
}
// Re-binding to a fresh const carries the narrowing through closures below;
// TS would otherwise lose `videoEl !== null` inside the callback bodies and
// flag every access as possibly-null.
const video: HTMLVideoElement = videoEl;

const slotAPI = window.slotAPI;
if (!slotAPI) {
  // Preload didn't run — the WCV was created with the wrong preload path
  // or contextBridge failed. Surface in the WCV's own console; main's
  // web-contents-log-forwarder will route it to the session log.
  console.error("slot-renderer: window.slotAPI missing — preload not wired");
  throw new Error("slot-renderer: window.slotAPI missing");
}

let hls: Hls | null = null;
let currentSlotId: string | null = null;

function tearDownHls(): void {
  if (hls) {
    try {
      hls.destroy();
    } catch {
      // Already destroyed by an error path; ignore.
    }
    hls = null;
  }
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    // Element may be in a transient state; safe to ignore.
  }
}

function loadStream(url: string): void {
  if (!Hls.isSupported()) {
    // Safari native HLS fallback.
    video.src = url;
    return;
  }
  if (hls) {
    // Channel-hop within the same slot lifetime: reuse the instance
    // (mirrors slice 09's HlsPlayer reuse pattern — keeps the decoder
    // warm, avoids the per-swap GPU/decoder re-init cost).
    try {
      hls.detachMedia();
      hls.loadSource(url);
      hls.attachMedia(video);
      return;
    } catch {
      // If reuse blows up (instance got into a bad state), fall through
      // to a fresh construction.
      tearDownHls();
    }
  }
  hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 30,
  });
  hls.loadSource(url);
  hls.attachMedia(video);
}

function reportPlayback(type: "playing" | "stalled" | "buffering" | "ended" | "error"): void {
  if (!currentSlotId) return;
  slotAPI?.reportPlaybackEvent({ slotId: currentSlotId, type });
}

video.addEventListener("playing", () => reportPlayback("playing"));
video.addEventListener("waiting", () => reportPlayback("buffering"));
video.addEventListener("stalled", () => reportPlayback("stalled"));
video.addEventListener("ended", () => reportPlayback("ended"));
video.addEventListener("error", () => reportPlayback("error"));

slotAPI.onLoadStream(({ slotId, payload }) => {
  currentSlotId = slotId;
  // payload.playbackUrl is added by main when it has the resolved URL
  // (slice 06 wires the resolver). Until then, fall back to a sentinel
  // that the host can detect and pass via a separate IPC.
  const url = (payload as unknown as { playbackUrl?: string }).playbackUrl;
  if (!url) {
    console.warn("slot-renderer: loadStream payload missing playbackUrl", {
      slotId,
      payload,
    });
    return;
  }
  loadStream(url);
});

slotAPI.onSetMute(({ muted }) => {
  video.muted = muted;
});

slotAPI.onUnload(() => {
  tearDownHls();
  currentSlotId = null;
});

window.addEventListener("beforeunload", () => {
  tearDownHls();
});
