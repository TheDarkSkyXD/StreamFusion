/**
 * Prediction Vote In-Flight Gate
 *
 * Module-scoped `Set<string>` of in-flight vote keys. Each key is
 * `${platform}:${slug}:${predictionId}` and is acquired right before the
 * mutation fires and released in the submit handler's `finally` block.
 *
 * Two purposes:
 *   1. Belt-and-suspenders against UI double-click: even if the submit
 *      button's `disabled` state lags React's commit, the second call to
 *      `acquire()` returns `false` and the handler no-ops.
 *   2. Defense against the optimistic-update + socket-echo collision the
 *      Kick dual-ID learning called out — a re-emitted `predictionUpdate`
 *      during a reconnect can race the local optimistic state.
 *
 * Pattern from `docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md`.
 *
 * Cleanup paths:
 *   - `clearForPrediction(predictionId)` — called on RESOLVED / CANCELED
 *     transitions so a settled prediction doesn't keep a stale key.
 *   - `clearForChannel(slug)` — called on widget unmount / channel switch
 *     so a torn-down panel doesn't leak gate entries across channels.
 *
 * Keys are parsed defensively: `platform` is always the first colon-
 * separated segment, `slug` is the second, and `predictionId` is
 * everything after the second colon (in case a real predictionId ever
 * contains a literal colon).
 */

const inFlight = new Set<string>();

export type PredictionVotePlatform = "twitch" | "kick";

/**
 * Compose a gate key from platform + slug + predictionId. Callers use this
 * helper rather than concatenating manually so the format stays in lockstep
 * with the parsers below.
 */
export function predictionVoteGateKey(
  platform: PredictionVotePlatform,
  slug: string,
  predictionId: string,
): string {
  return `${platform}:${slug}:${predictionId}`;
}

/**
 * Attempt to acquire the gate for `key`. Returns `true` if newly acquired,
 * `false` if a vote with the same key was already in flight. The caller
 * MUST wrap the mutation in `try { ... } finally { release(key) }` after a
 * successful acquire.
 */
export function acquire(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

/**
 * Release `key`. Idempotent — safe to call even when the key isn't held
 * (matches Set.delete behavior).
 */
export function release(key: string): void {
  inFlight.delete(key);
}

/**
 * Predicate for "is this exact key currently in flight". Used by tests and
 * by UI code that wants to render an instant-pending state without firing
 * a duplicate acquire.
 */
export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

/**
 * Remove any entries whose predictionId segment matches `predictionId`.
 * The predictionId is the third (last) colon-separated segment of the key
 * — `split` with a limit of 3 keeps real-world predictionIds intact even
 * if one ever contained a literal colon.
 */
export function clearForPrediction(predictionId: string): void {
  for (const key of inFlight) {
    if (extractPredictionId(key) === predictionId) {
      inFlight.delete(key);
    }
  }
}

/**
 * Remove any entries whose slug segment matches `slug`. Called on widget
 * unmount or channel switch so a torn-down panel doesn't leak gate entries
 * across channels.
 */
export function clearForChannel(slug: string): void {
  for (const key of inFlight) {
    if (extractSlug(key) === slug) {
      inFlight.delete(key);
    }
  }
}

function extractSlug(key: string): string {
  // Format: platform:slug:predictionId — slug is the second segment.
  const firstColon = key.indexOf(":");
  if (firstColon < 0) return "";
  const secondColon = key.indexOf(":", firstColon + 1);
  if (secondColon < 0) return key.slice(firstColon + 1);
  return key.slice(firstColon + 1, secondColon);
}

function extractPredictionId(key: string): string {
  // Format: platform:slug:predictionId — predictionId is everything after
  // the second colon (preserving any literal colons inside the id).
  const firstColon = key.indexOf(":");
  if (firstColon < 0) return "";
  const secondColon = key.indexOf(":", firstColon + 1);
  if (secondColon < 0) return "";
  return key.slice(secondColon + 1);
}

/**
 * Test-only: wipe the entire gate. Exported under a `__test` prefix so
 * production code can't accidentally use it.
 */
export function __resetForTests(): void {
  inFlight.clear();
}
