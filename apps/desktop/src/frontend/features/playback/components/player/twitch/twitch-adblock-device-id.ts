/**
 * Twitch ad-block device-id helpers (plan U13).
 *
 * The ad-block GQL device-id is NOT an `AdBlockConfig` field. It is a 32-char
 * value persisted in `localStorage["twitch_adblock_device_id"]` and seeded into
 * the ad-block service's module-level `gqlDeviceId` via `setAuthHeaders` on
 * player mount (see twitch-hls-player.tsx). The non-ad-block resolver path sends
 * no `X-Device-Id` at all, so this only affects the ad-block token requests.
 *
 * "Randomize" clears + regenerates the persisted value. The live module value
 * is seeded once on player mount and the GQL device-id header is read from it at
 * request time, so a randomize takes effect on the NEXT stream load (the player
 * remount re-seeds from localStorage). This helper deliberately does NOT mutate
 * the live module — calling `setAuthHeaders` with only a device id would clobber
 * any auth/integrity headers a stream had set. The UI states the next-load
 * caveat; don't claim it's live.
 */

export const ADBLOCK_DEVICE_ID_STORAGE_KEY = "twitch_adblock_device_id";

const DEVICE_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const DEVICE_ID_LENGTH = 32;

/** Generate a fresh 32-char device id (same alphabet/length the service uses). */
export function generateAdBlockDeviceId(): string {
  let id = "";
  for (let i = 0; i < DEVICE_ID_LENGTH; i++) {
    id += DEVICE_ID_CHARS.charAt(Math.floor(Math.random() * DEVICE_ID_CHARS.length));
  }
  return id;
}

/** The persisted device id, or `null` when none has been seeded yet. */
export function getAdBlockDeviceId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ADBLOCK_DEVICE_ID_STORAGE_KEY);
}

/**
 * Clear + regenerate the persisted device id and return the new value. Takes
 * effect on the next stream load (the player remount re-seeds the live value).
 */
export function randomizeAdBlockDeviceId(): string {
  const next = generateAdBlockDeviceId();
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(ADBLOCK_DEVICE_ID_STORAGE_KEY);
    localStorage.setItem(ADBLOCK_DEVICE_ID_STORAGE_KEY, next);
  }
  return next;
}
