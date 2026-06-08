/**
 * SlotPresence → slot configuration. Pure function that resolves the
 * concrete (quality, forward-buffer, back-buffer, mute) tuple a slot should
 * receive for a given attention state + user background-quality preference.
 *
 * Slice 07 of the renderer-OOM PRD (#51, issue #58). The PRD pins the
 * matrix; this module is the executable copy of it.
 *
 * | Presence  | Quality                           | Fwd buffer | Back buffer | Audio |
 * |-----------|-----------------------------------|------------|-------------|-------|
 * | focused   | source / user-selected            | 30s        | 30s         | on    |
 * | background| user pref (auto-low / match / off)| 10s        | 0s          | muted |
 * | hidden    | n/a (WCV is destroyed)            | n/a        | n/a         | muted |
 *
 * "Hidden" returns a config sentinel that says "do nothing on the WCV
 * because there is no WCV". The slot-controller checks for `hidden` separately
 * to decide whether to destroy the view; this module just gives a
 * truthful-shaped tuple so callers don't need to special-case the union.
 */

import type { SlotPresence, SlotQualityMode } from "./slot-types";

export interface SlotConfig {
  /**
   * Slot quality preference passed through to the HLS player. For background
   * slots this resolves the user's `BackgroundQuality` setting; for focused
   * slots it's always `match-source` (which the player interprets as
   * "use the slot's own quality picker"). For hidden slots there's no
   * player — the slot-controller skips the dispatch entirely.
   */
  quality: SlotQualityMode;
  /** Forward (ahead-of-playhead) buffer length in seconds. */
  forwardBufferSec: number;
  /** Back (behind-playhead) buffer length in seconds. */
  backBufferSec: number;
  /** Audio state — `true` means muted. */
  muted: boolean;
}

/** Focused slot config — source quality, full buffers, audio on. */
export const FOCUSED_SLOT_CONFIG: Readonly<SlotConfig> = Object.freeze({
  quality: "match-source",
  forwardBufferSec: 30,
  backBufferSec: 30,
  muted: false,
});

/** Hidden slot config — no WCV; the slot-controller doesn't dispatch this. */
export const HIDDEN_SLOT_CONFIG: Readonly<SlotConfig> = Object.freeze({
  quality: "off",
  forwardBufferSec: 0,
  backBufferSec: 0,
  muted: true,
});

/**
 * Resolve the config a slot should receive given its presence and the user's
 * background-quality preference. Pure — no observable side effects, no I/O.
 *
 * `userBackgroundQuality` is consulted ONLY when presence === "background".
 */
export function resolveSlotConfig(
  presence: SlotPresence,
  userBackgroundQuality: SlotQualityMode
): SlotConfig {
  switch (presence) {
    case "focused":
      return { ...FOCUSED_SLOT_CONFIG };
    case "background":
      return {
        quality: userBackgroundQuality,
        forwardBufferSec: 10,
        backBufferSec: 0,
        muted: true,
      };
    case "hidden":
      return { ...HIDDEN_SLOT_CONFIG };
  }
}
