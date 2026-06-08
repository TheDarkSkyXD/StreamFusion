/**
 * Slot type definitions shared between main and renderer. Introduced in slice
 * 04 of the renderer-OOM PRD (#51). Slot lifecycle, presence transitions, and
 * dispatch payloads all reference the types defined here so the contract is
 * single-sourced.
 */

import type { Platform } from "./auth-types";

/**
 * SlotPresence is the user-attention state of a StreamSlot:
 * - `focused`: the slot the user is actively watching. Exactly one slot is
 *   focused at any time when at least one slot exists. Drives full quality,
 *   full buffer, and audio (later slices).
 * - `background`: on-screen but unfocused in multiview. Quality clamp, trimmed
 *   buffer, muted (slice 07).
 * - `hidden`: not rendered right now (collapsed tab, off-screen). HLS instance
 *   is torn down entirely (slice 07).
 */
export type SlotPresence = "focused" | "background" | "hidden";

/**
 * BackgroundQuality is the user-configurable clamp for `background` slots. Same
 * union as `multistream-store.BackgroundQuality` — co-located here so the
 * dispatch payload doesn't drag the store into the main process.
 */
export type SlotQualityMode = "auto-low" | "match-source" | "off";

export interface LoadStreamPayload {
  platform: Platform;
  channelName: string;
}

export interface SlotQualityConfig {
  mode: SlotQualityMode;
}

export interface SlotBufferConfig {
  maxBufferLengthSec: number;
  maxMaxBufferLengthSec: number;
  liveSyncDurationCount: number;
}

/**
 * Discriminated union for every slot dispatch event. Listener consumers
 * (the host renderer in slice 04, the WebContentsView in slice 05+) read
 * `type` and switch.
 *
 * `retry-affordance` (slice 06): emitted after the SECOND crash within the
 * 5-minute window. Host renderer responds by showing a "Stream crashed —
 * click to retry" overlay in the slot's chrome. When the user clicks, the
 * host calls slot:request-retry which rebuilds the WCV.
 */
export type SlotEvent =
  | { type: "load-stream"; slotId: string; payload: LoadStreamPayload }
  | { type: "set-mute"; slotId: string; muted: boolean }
  | { type: "set-quality"; slotId: string; config: SlotQualityConfig }
  | { type: "set-buffer-config"; slotId: string; config: SlotBufferConfig }
  | { type: "unload"; slotId: string }
  | { type: "presence-changed"; slotId: string; presence: SlotPresence }
  | { type: "retry-affordance"; slotId: string };
