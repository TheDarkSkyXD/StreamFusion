/**
 * StreamSlot lifecycle + presence state machine (main process). Single source
 * of truth for "which slots exist, who's focused, how many can we have". Pure
 * in-memory state — mirrors the platform-health.ts shape (module-level state,
 * listener Set, __resetForTests hook).
 *
 * Slice 04 of the renderer-OOM PRD (#51). At this slice the controller emits
 * dispatch events through `onSlotEvent` — the WebContentsView consumer lands
 * in slice 05; the host renderer is the temporary consumer in slice 04.
 */

import type {
  LoadStreamPayload,
  SlotBufferConfig,
  SlotEvent,
  SlotPresence,
  SlotQualityConfig,
} from "../../../shared/slot-types";

interface SlotRecord {
  id: string;
  presence: SlotPresence;
}

const slots = new Map<string, SlotRecord>();
const listeners = new Set<(event: SlotEvent) => void>();

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

export function createSlot(id: string): void {
  if (slots.has(id)) return;
  if (slots.size >= maxSlots) return;
  const presence: SlotPresence = slots.size === 0 ? "focused" : "background";
  slots.set(id, { id, presence });
}

export function destroySlot(id: string): void {
  slots.delete(id);
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
  if (!slots.has(slotId)) return;
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

export function __resetSlotControllerForTests(): void {
  slots.clear();
  listeners.clear();
  maxSlots = 6;
}
