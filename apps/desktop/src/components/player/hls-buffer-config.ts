/**
 * Maps the user's `buffer` preferences (auth-types `BufferPreferences`) to the
 * HLS.js config fields consumed at the `new Hls({...})` construction site for
 * LIVE playback. Shared by both player files (Twitch ad-block player + the
 * shared Kick-live player).
 *
 * liveSync key choice: target live latency maps to `liveSyncDurationCount`
 * (segment count) rather than `liveSyncDuration` (seconds). That count is what
 * both players already used (so defaults = a no-op), its sibling
 * `liveMaxLatencyDurationCount` is also count-based, and HLS.js treats the
 * seconds form as a mutually-exclusive override of the count — keeping the
 * family count-based avoids mixing the two. See plan U10.
 *
 * maxBufferSize interaction: `maxBufferLength` / `maxMaxBufferLength` are bounded
 * by the `maxBufferSize` (bytes) soft cap, so a raised max-buffer would be
 * silently clamped. We scale `maxBufferSize` proportionally to the configured
 * `maxMaxBufferLengthSec` (relative to the default 30s → 20 MB) so the
 * configured length is actually honored, never below the original 20 MB floor.
 */

import { type BufferPreferences, DEFAULT_BUFFER_PREFERENCES } from "@/shared/auth-types";

/** The HLS.js config fields this module owns. */
export interface HlsBufferConfig {
  lowLatencyMode: boolean;
  liveSyncDurationCount: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
  maxBufferSize: number;
}

/** Original hardcoded soft cap; the floor for the scaled value. */
const DEFAULT_MAX_BUFFER_SIZE_BYTES = 20 * 1000 * 1000;

/** A finite, positive number, else the default. Guards NaN/empty/≤0 input. */
function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolve the persisted (possibly partial / legacy) buffer prefs into a complete
 * HLS.js config object. Each field falls back to its documented default when
 * missing or invalid, so no NaN can reach the HLS config.
 */
export function resolveHlsBufferConfig(prefs?: Partial<BufferPreferences>): HlsBufferConfig {
  const liveSyncDurationCount = positiveOr(
    prefs?.liveSyncDurationCount,
    DEFAULT_BUFFER_PREFERENCES.liveSyncDurationCount
  );
  const maxBufferLength = positiveOr(
    prefs?.maxBufferLengthSec,
    DEFAULT_BUFFER_PREFERENCES.maxBufferLengthSec
  );
  const maxMaxBufferLength = positiveOr(
    prefs?.maxMaxBufferLengthSec,
    DEFAULT_BUFFER_PREFERENCES.maxMaxBufferLengthSec
  );
  const lowLatencyMode =
    typeof prefs?.lowLatencyMode === "boolean"
      ? prefs.lowLatencyMode
      : DEFAULT_BUFFER_PREFERENCES.lowLatencyMode;

  // Scale the byte cap with the configured max length so a raised buffer isn't
  // silently clamped; never drop below the original 20 MB floor.
  const maxBufferSize = Math.max(
    DEFAULT_MAX_BUFFER_SIZE_BYTES,
    Math.round(
      (maxMaxBufferLength / DEFAULT_BUFFER_PREFERENCES.maxMaxBufferLengthSec) *
        DEFAULT_MAX_BUFFER_SIZE_BYTES
    )
  );

  return {
    lowLatencyMode,
    liveSyncDurationCount,
    maxBufferLength,
    maxMaxBufferLength,
    maxBufferSize,
  };
}
