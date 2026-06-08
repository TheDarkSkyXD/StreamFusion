/**
 * StreamSlot lifecycle + presence state machine (main process). Single source
 * of truth for "which slots exist, who's focused, how many can we have". Pure
 * in-memory state — mirrors the platform-health.ts shape (module-level state,
 * listener Set, __resetForTests hook).
 *
 * Slice 04 of the renderer-OOM PRD (#51). At this slice the controller emits
 * dispatch events through `onSlotEvent` — the WebContentsView consumer lands
 * in slice 05; the host renderer is the temporary consumer in slice 04.
 *
 * Slice 05 (#56) plumbing: when `setUseWebContentsViews(true)` is set, each
 * createSlot also spawns a per-slot WCV via the webcontents-view-factory.
 * The view is stored on the slot record so the IPC bridge can route dispatch
 * events to it. Flag defaults to OFF — the renderer-path fall-back is the
 * source of truth until slice 06's full migration + dogfood sign-off.
 */

import type {
  LoadStreamPayload,
  SlotBufferConfig,
  SlotEvent,
  SlotPresence,
  SlotQualityConfig,
} from "../../../shared/slot-types";
import { decideSlotRetryOutcome } from "./slot-retry-policy";
import {
  getSlotPreloadPath,
  getSlotRendererUrl,
  getWebContentsViewFactory,
  type SlotView,
} from "./webcontents-view-factory";

interface SlotRecord {
  id: string;
  presence: SlotPresence;
  view: SlotView | null;
  /** Most recent load-stream payload — replayed on a silent-retry rebuild. */
  lastLoadStream: LoadStreamPayload | null;
  /** Wall-clock timestamps of renderer crashes; consulted by the retry policy. */
  crashTimestamps: number[];
  /** Unsubscribe handle for the current view's render-process-gone listener. */
  unsubscribeCrashListener: (() => void) | null;
}

const slots = new Map<string, SlotRecord>();
const listeners = new Set<(event: SlotEvent) => void>();
let useWebContentsViews = false;

/**
 * Hard upper bound on concurrent slots. The renderer's MultiviewCap (settings
 * slider, default 4) is pushed in via setMaxSlots() at boot and on change.
 * Default of 6 here matches MULTIVIEW_CAP_MAX so an un-initialized controller
 * never silently rejects creates — the renderer's own cap check is the source
 * of truth from the user's perspective; this is the main-side backstop.
 */
let maxSlots = 6;

function emit(event: SlotEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

function spawnViewForSlot(id: string): SlotView {
  const view = getWebContentsViewFactory().create({ preloadPath: getSlotPreloadPath() });
  // Fire-and-forget: a load failure (dev-server down, malformed URL) is
  // surfaced via the slot's own console → web-contents-log-forwarder.
  // Tests inject a fake factory whose loadURL is a vi.fn() and ignore
  // the returned promise.
  void view.loadURL(getSlotRendererUrl());
  return view;
}

function attachCrashListener(slot: SlotRecord, view: SlotView): void {
  slot.unsubscribeCrashListener = view.onRenderProcessGone(() => {
    handleSlotCrash(slot.id);
  });
}

export function createSlot(id: string): void {
  if (slots.has(id)) return;
  if (slots.size >= maxSlots) return;
  const presence: SlotPresence = slots.size === 0 ? "focused" : "background";
  const record: SlotRecord = {
    id,
    presence,
    view: null,
    lastLoadStream: null,
    crashTimestamps: [],
    unsubscribeCrashListener: null,
  };
  if (useWebContentsViews) {
    const view = spawnViewForSlot(id);
    record.view = view;
    attachCrashListener(record, view);
  }
  slots.set(id, record);
}

export function destroySlot(id: string): void {
  const slot = slots.get(id);
  if (!slot) return;
  if (slot.unsubscribeCrashListener) {
    slot.unsubscribeCrashListener();
    slot.unsubscribeCrashListener = null;
  }
  if (slot.view) {
    slot.view.destroy();
  }
  slots.delete(id);
}

/**
 * Toggle the WCV-per-slot path. OFF by default so production renderers keep
 * driving the player in-process. Slice 06 flips this on by default after the
 * dogfood sign-off; until then it's an opt-in dev flag.
 */
export function setUseWebContentsViews(enabled: boolean): void {
  useWebContentsViews = enabled;
}

/** Returns the SlotView spawned for this slot when the flag was on, else null. */
export function getSlotView(id: string): SlotView | null {
  return slots.get(id)?.view ?? null;
}

/**
 * Update the slot cap from the renderer-side MultiviewCap. Caps below the
 * current slot count are accepted: existing slots are NOT retroactively
 * evicted — only future createSlot calls are blocked until the count drops
 * back under the cap. Matches the multistream-store policy from slice 03.
 */
export function setMaxSlots(n: number): void {
  maxSlots = n;
}

export function getSlotPresence(id: string): SlotPresence | undefined {
  return slots.get(id)?.presence;
}

export function getFocusedSlotId(): string | null {
  for (const slot of slots.values()) {
    if (slot.presence === "focused") return slot.id;
  }
  return null;
}

/**
 * Transition a slot's presence. Promoting a slot to `focused` demotes any
 * previously-focused slot to `background` — the controller enforces the
 * focus-singleton invariant. Setting `hidden` or `background` does not touch
 * other slots.
 */
export function setSlotPresence(id: string, presence: SlotPresence): void {
  const slot = slots.get(id);
  if (!slot) return;
  if (presence === "focused") {
    for (const other of slots.values()) {
      if (other.id !== id && other.presence === "focused") {
        other.presence = "background";
        emit({ type: "presence-changed", slotId: other.id, presence: "background" });
      }
    }
  }
  if (slot.presence === presence) return;
  slot.presence = presence;
  emit({ type: "presence-changed", slotId: id, presence });
}

export function onSlotEvent(listener: (event: SlotEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatchLoadStream(slotId: string, payload: LoadStreamPayload): void {
  const slot = slots.get(slotId);
  if (!slot) return;
  // Remember the most recent payload so a silent-retry crash rebuild can
  // replay the same stream into the fresh WCV.
  slot.lastLoadStream = payload;
  emit({ type: "load-stream", slotId, payload });
}

export function dispatchSetMute(slotId: string, muted: boolean): void {
  if (!slots.has(slotId)) return;
  emit({ type: "set-mute", slotId, muted });
}

export function dispatchSetQuality(slotId: string, config: SlotQualityConfig): void {
  if (!slots.has(slotId)) return;
  emit({ type: "set-quality", slotId, config });
}

export function dispatchSetBufferConfig(slotId: string, config: SlotBufferConfig): void {
  if (!slots.has(slotId)) return;
  emit({ type: "set-buffer-config", slotId, config });
}

export function dispatchUnload(slotId: string): void {
  if (!slots.has(slotId)) return;
  emit({ type: "unload", slotId });
}

/**
 * Slot crash recovery (slice 06 of renderer-OOM PRD #51). Triggered by the
 * view's `render-process-gone` listener. Pushes the timestamp, asks the
 * pure retry policy what to do, and either rebuilds the WCV silently +
 * replays the last loadStream, or emits a `retry-affordance` event so the
 * host can show a "click to retry" overlay in the slot chrome.
 *
 * `nowOverride` is only for tests; production reads `Date.now()`.
 */
export function handleSlotCrash(slotId: string, nowOverride?: number): void {
  const slot = slots.get(slotId);
  if (!slot) return;
  const now = nowOverride ?? Date.now();
  slot.crashTimestamps.push(now);
  const outcome = decideSlotRetryOutcome(slot.crashTimestamps, now);

  // Tear down the dead view + listener regardless of outcome.
  if (slot.unsubscribeCrashListener) {
    slot.unsubscribeCrashListener();
    slot.unsubscribeCrashListener = null;
  }
  if (slot.view) {
    try {
      slot.view.destroy();
    } catch {
      // The view is already in a dead state — destroy may throw; ignore.
    }
    slot.view = null;
  }

  if (outcome === "silent-retry") {
    const view = spawnViewForSlot(slotId);
    slot.view = view;
    attachCrashListener(slot, view);
    if (slot.lastLoadStream) {
      emit({ type: "load-stream", slotId, payload: slot.lastLoadStream });
    }
    return;
  }

  // outcome === "affordance"
  emit({ type: "retry-affordance", slotId });
}

/**
 * Host calls this when the user clicks the retry overlay after the
 * affordance was shown. Spawns a fresh WCV and replays the last stream.
 */
export function requestSlotRetry(slotId: string): void {
  const slot = slots.get(slotId);
  if (!slot) return;
  if (slot.view) {
    // Already alive (race with a silent-retry that completed first). No-op.
    return;
  }
  const view = spawnViewForSlot(slotId);
  slot.view = view;
  attachCrashListener(slot, view);
  if (slot.lastLoadStream) {
    emit({ type: "load-stream", slotId, payload: slot.lastLoadStream });
  }
}

/**
 * Host calls this after a host-renderer reload (post-crash) so main can
 * push the current slot snapshot back. Slice 06's host crash recovery
 * relies on this: main re-emits a presence-changed event for every slot
 * so the host renderer rebuilds its slot chrome from scratch.
 */
export function rebindExistingSlots(): void {
  for (const slot of slots.values()) {
    emit({ type: "presence-changed", slotId: slot.id, presence: slot.presence });
  }
}

export function __resetSlotControllerForTests(): void {
  for (const slot of slots.values()) {
    if (slot.unsubscribeCrashListener) {
      try {
        slot.unsubscribeCrashListener();
      } catch {
        // Listener teardown may throw on a stale closure; ignore.
      }
    }
    if (slot.view) {
      try {
        slot.view.destroy();
      } catch {
        // Test fakes may already have torn down; ignore.
      }
    }
  }
  slots.clear();
  listeners.clear();
  maxSlots = 6;
  useWebContentsViews = false;
}
