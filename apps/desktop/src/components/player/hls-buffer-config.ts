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
  liveMaxLatencyDurationCount: number;
  backBufferLength: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
  maxBufferSize: number;
}

/** Original hardcoded soft cap; the floor for the scaled value. */
const DEFAULT_MAX_BUFFER_SIZE_BYTES = 20 * 1000 * 1000;
const DEFAULT_MAX_BUFFER_SIZE_REFERENCE_SECONDS = 30;

const VOD_BUFFER_PREFERENCES: BufferPreferences = {
  lowLatencyMode: false,
  liveSyncDurationCount: DEFAULT_BUFFER_PREFERENCES.liveSyncDurationCount,
  maxBufferLengthSec: 30,
  maxMaxBufferLengthSec: 60,
};

const LIVE_BACK_BUFFER_LENGTH_SECONDS = 5;
const VOD_BACK_BUFFER_LENGTH_SECONDS = 30;
const LIVE_MAX_BUFFER_LENGTH_SECONDS = 10;
const LIVE_MAX_MAX_BUFFER_LENGTH_SECONDS = 20;

/**
 * Original hardcoded `liveMaxLatencyDurationCount`. HLS.js requires
 * `liveSyncDurationCount < liveMaxLatencyDurationCount`, so we derive the max as
 * `liveSync + MARGIN` floored at this default — a user raising the live-sync
 * target (slider goes to 10) can't produce an invalid config where sync >= max.
 * The margin matches the original default gap (6 - 2 = 4), so default prefs
 * (liveSync 2 → max 6) reproduce the old hardcoded value exactly.
 */
const DEFAULT_LIVE_MAX_LATENCY_COUNT = 6;
const LIVE_LATENCY_COUNT_MARGIN = 4;

/** A finite, positive number, else the default. Guards NaN/empty/≤0 input. */
function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

interface ResolveHlsBufferConfigOptions {
  capLiveBuffer?: boolean;
}

/**
 * Resolve the persisted (possibly partial / legacy) buffer prefs into a complete
 * HLS.js config object. Each field falls back to its documented default when
 * missing or invalid, so no NaN can reach the HLS config.
 */
export function resolveHlsBufferConfig(
  prefs?: Partial<BufferPreferences>,
  options: ResolveHlsBufferConfigOptions = {}
): HlsBufferConfig {
  const capLiveBuffer = options.capLiveBuffer ?? true;
  const liveSyncDurationCount = positiveOr(
    prefs?.liveSyncDurationCount,
    DEFAULT_BUFFER_PREFERENCES.liveSyncDurationCount
  );
  // HLS.js requires liveSyncDurationCount < liveMaxLatencyDurationCount. The two
  // sliders are independent, so derive the max from the sync value (never the
  // other way) to keep the config valid no matter where the user drags it.
  const liveMaxLatencyDurationCount = Math.max(
    DEFAULT_LIVE_MAX_LATENCY_COUNT,
    liveSyncDurationCount + LIVE_LATENCY_COUNT_MARGIN
  );
  const preferredMaxMaxBufferLength = positiveOr(
    prefs?.maxMaxBufferLengthSec,
    DEFAULT_BUFFER_PREFERENCES.maxMaxBufferLengthSec
  );
  const maxMaxBufferLength = capLiveBuffer
    ? Math.min(preferredMaxMaxBufferLength, LIVE_MAX_MAX_BUFFER_LENGTH_SECONDS)
    : preferredMaxMaxBufferLength;
  // Forward buffer must not exceed the hard cap — HLS.js treats
  // maxMaxBufferLength as the ceiling and would silently clamp a larger forward
  // value, so a user setting forward=60s / max=10s wouldn't get the 60s they
  // asked for. Clamp here so the effective value is honest.
  const preferredMaxBufferLength = positiveOr(
    prefs?.maxBufferLengthSec,
    DEFAULT_BUFFER_PREFERENCES.maxBufferLengthSec
  );
  const maxBufferLength = Math.min(
    preferredMaxBufferLength,
    maxMaxBufferLength,
    capLiveBuffer ? LIVE_MAX_BUFFER_LENGTH_SECONDS : Number.POSITIVE_INFINITY
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
      (maxMaxBufferLength / DEFAULT_MAX_BUFFER_SIZE_REFERENCE_SECONDS) *
        DEFAULT_MAX_BUFFER_SIZE_BYTES
    )
  );

  return {
    lowLatencyMode,
    liveSyncDurationCount,
    liveMaxLatencyDurationCount,
    backBufferLength: capLiveBuffer
      ? LIVE_BACK_BUFFER_LENGTH_SECONDS
      : VOD_BACK_BUFFER_LENGTH_SECONDS,
    maxBufferLength,
    maxMaxBufferLength,
    maxBufferSize,
  };
}

export function resolveHlsVodBufferConfig(): HlsBufferConfig {
  return resolveHlsBufferConfig(VOD_BUFFER_PREFERENCES, { capLiveBuffer: false });
}
