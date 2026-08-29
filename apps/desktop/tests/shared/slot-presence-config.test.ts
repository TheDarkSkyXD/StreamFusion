import { describe, expect, it } from "vitest";

import {
  FOCUSED_SLOT_CONFIG,
  HIDDEN_SLOT_CONFIG,
  resolveSlotConfig,
} from "@shared/slot-presence-config";
import type { SlotPresence, SlotQualityMode } from "@shared/slot-types";

// Guards: slice 07 of renderer-OOM PRD (#51, issue #58). Pure config module
// — tableau-tested across every (presence, userBackgroundQuality) pair. The
// matrix is load-bearing for memory reduction: if `background` slots stop
// getting the buffer trim or mute, the WCV-per-slot tax dominates and the
// fix becomes a regression.

const QUALITY_MODES: SlotQualityMode[] = ["auto-low", "match-source", "off"];

describe("resolveSlotConfig — focused", () => {
  it.each(QUALITY_MODES)(
    "ignores the user background-quality preference (%s) and returns the focused tuple",
    (mode) => {
      const cfg = resolveSlotConfig("focused", mode);
      expect(cfg).toEqual({
        quality: "match-source",
        forwardBufferSec: 30,
        backBufferSec: 30,
        muted: false,
      });
    }
  );
});

describe("resolveSlotConfig — background", () => {
  it("clamps quality to the user's BackgroundQuality preference (auto-low)", () => {
    const cfg = resolveSlotConfig("background", "auto-low");
    expect(cfg.quality).toBe("auto-low");
  });

  it("respects 'match-source' as the BackgroundQuality preference", () => {
    const cfg = resolveSlotConfig("background", "match-source");
    expect(cfg.quality).toBe("match-source");
  });

  it("respects 'off' as the BackgroundQuality preference (audio-only)", () => {
    const cfg = resolveSlotConfig("background", "off");
    expect(cfg.quality).toBe("off");
  });

  it.each(QUALITY_MODES)("uses trimmed buffers (10s/0s) and muted audio (mode %s)", (mode) => {
    const cfg = resolveSlotConfig("background", mode);
    expect(cfg.forwardBufferSec).toBe(10);
    expect(cfg.backBufferSec).toBe(0);
    expect(cfg.muted).toBe(true);
  });
});

describe("resolveSlotConfig — hidden", () => {
  it.each(QUALITY_MODES)(
    "ignores the user background-quality preference (%s) and returns the hidden tuple",
    (mode) => {
      const cfg = resolveSlotConfig("hidden", mode);
      expect(cfg).toEqual({
        quality: "off",
        forwardBufferSec: 0,
        backBufferSec: 0,
        muted: true,
      });
    }
  );
});

describe("resolveSlotConfig — frozen constants", () => {
  it("FOCUSED_SLOT_CONFIG is frozen (so callers can't mutate the shared tuple)", () => {
    expect(Object.isFrozen(FOCUSED_SLOT_CONFIG)).toBe(true);
  });

  it("HIDDEN_SLOT_CONFIG is frozen", () => {
    expect(Object.isFrozen(HIDDEN_SLOT_CONFIG)).toBe(true);
  });

  it("returns a NEW SlotConfig object each call (no shared mutable refs)", () => {
    const a = resolveSlotConfig("focused", "auto-low");
    const b = resolveSlotConfig("focused", "auto-low");
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("resolveSlotConfig — tableau (every presence × every quality mode)", () => {
  const presences: SlotPresence[] = ["focused", "background", "hidden"];

  for (const presence of presences) {
    for (const mode of QUALITY_MODES) {
      it(`(presence=${presence}, q=${mode}) is deterministic and complete`, () => {
        const cfg = resolveSlotConfig(presence, mode);
        // Every field is present and well-typed.
        expect(typeof cfg.quality).toBe("string");
        expect(typeof cfg.forwardBufferSec).toBe("number");
        expect(typeof cfg.backBufferSec).toBe("number");
        expect(typeof cfg.muted).toBe("boolean");
        // Non-focused presences are muted by contract.
        if (presence !== "focused") expect(cfg.muted).toBe(true);
        // Background uses the user's quality preference; others ignore it.
        if (presence === "background") expect(cfg.quality).toBe(mode);
      });
    }
  }
});
