import { describe, expect, it } from "vitest";

import { resolveHlsBufferConfig } from "@/components/player/hls-buffer-config";
import { DEFAULT_BUFFER_PREFERENCES } from "@/shared/auth-types";

// AE9 / U10: the buffer prefs that a player reads at `new Hls({...})` construction
// must produce the expected HLS config object. We exercise the pure mapper that
// both player files call, so the assertion is platform-agnostic.

const DEFAULT_MAX_BUFFER_SIZE_BYTES = 20 * 1000 * 1000;

describe("resolveHlsBufferConfig (U10)", () => {
  it("maps the documented defaults to the previously-hardcoded HLS config (no behavior change)", () => {
    expect(resolveHlsBufferConfig(DEFAULT_BUFFER_PREFERENCES)).toEqual({
      lowLatencyMode: true,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 6,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      maxBufferSize: DEFAULT_MAX_BUFFER_SIZE_BYTES,
    });
  });

  it("maps a custom buffer pref to the expected HLS config", () => {
    const config = resolveHlsBufferConfig({
      lowLatencyMode: false,
      liveSyncDurationCount: 4,
      maxBufferLengthSec: 30,
      maxMaxBufferLengthSec: 60,
    });

    expect(config.lowLatencyMode).toBe(false);
    expect(config.liveSyncDurationCount).toBe(4);
    expect(config.maxBufferLength).toBe(30);
    expect(config.maxMaxBufferLength).toBe(60);
  });

  it("scales maxBufferSize with the configured max buffer so a raised value isn't clamped", () => {
    // 60s is 2x the 30s default, so the byte budget doubles to 40 MB.
    const raised = resolveHlsBufferConfig({ ...DEFAULT_BUFFER_PREFERENCES, maxMaxBufferLengthSec: 60 });
    expect(raised.maxBufferSize).toBe(2 * DEFAULT_MAX_BUFFER_SIZE_BYTES);

    // Lowering the cap never drops below the original 20 MB floor.
    const lowered = resolveHlsBufferConfig({ ...DEFAULT_BUFFER_PREFERENCES, maxMaxBufferLengthSec: 10 });
    expect(lowered.maxBufferSize).toBe(DEFAULT_MAX_BUFFER_SIZE_BYTES);
  });

  it("reset to defaults restores the documented default config", () => {
    // The Settings 'Reset to defaults' writes DEFAULT_BUFFER_PREFERENCES; the
    // mapper must reproduce the original config from it.
    expect(resolveHlsBufferConfig({ ...DEFAULT_BUFFER_PREFERENCES })).toEqual(
      resolveHlsBufferConfig(DEFAULT_BUFFER_PREFERENCES)
    );
  });

  it("falls back to defaults for missing / undefined prefs (no NaN reaches HLS)", () => {
    const fromUndefined = resolveHlsBufferConfig(undefined);
    expect(fromUndefined).toEqual(resolveHlsBufferConfig(DEFAULT_BUFFER_PREFERENCES));

    const fromEmpty = resolveHlsBufferConfig({});
    expect(fromEmpty).toEqual(resolveHlsBufferConfig(DEFAULT_BUFFER_PREFERENCES));

    for (const value of Object.values(fromEmpty)) {
      if (typeof value === "number") expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("falls back to defaults for invalid numeric values (NaN, 0, negative, non-number)", () => {
    const config = resolveHlsBufferConfig({
      liveSyncDurationCount: Number.NaN,
      maxBufferLengthSec: 0,
      maxMaxBufferLengthSec: -5,
      // @ts-expect-error — exercising runtime guards against malformed persisted data
      lowLatencyMode: "yes",
    });

    expect(config.liveSyncDurationCount).toBe(DEFAULT_BUFFER_PREFERENCES.liveSyncDurationCount);
    expect(config.maxBufferLength).toBe(DEFAULT_BUFFER_PREFERENCES.maxBufferLengthSec);
    expect(config.maxMaxBufferLength).toBe(DEFAULT_BUFFER_PREFERENCES.maxMaxBufferLengthSec);
    expect(config.lowLatencyMode).toBe(DEFAULT_BUFFER_PREFERENCES.lowLatencyMode);
    // And crucially, no NaN leaked into the byte budget.
    expect(Number.isNaN(config.maxBufferSize)).toBe(false);
  });

  it("derives liveMaxLatencyDurationCount above liveSyncDurationCount so the config stays valid", () => {
    // Default (liveSync 2) reproduces the old hardcoded 6.
    expect(resolveHlsBufferConfig(DEFAULT_BUFFER_PREFERENCES).liveMaxLatencyDurationCount).toBe(6);
    // Slider at its max (10) must not produce sync >= max (HLS.js requires sync < max).
    const high = resolveHlsBufferConfig({ ...DEFAULT_BUFFER_PREFERENCES, liveSyncDurationCount: 10 });
    expect(high.liveMaxLatencyDurationCount).toBeGreaterThan(high.liveSyncDurationCount);
    expect(high.liveMaxLatencyDurationCount).toBe(14);
  });

  it("clamps forward buffer so it never exceeds the max-buffer ceiling", () => {
    // forward 60s with a 10s hard cap is an inverted (invalid) HLS config.
    const inverted = resolveHlsBufferConfig({
      ...DEFAULT_BUFFER_PREFERENCES,
      maxBufferLengthSec: 60,
      maxMaxBufferLengthSec: 10,
    });
    expect(inverted.maxBufferLength).toBeLessThanOrEqual(inverted.maxMaxBufferLength);
    expect(inverted.maxBufferLength).toBe(10);
  });
});
