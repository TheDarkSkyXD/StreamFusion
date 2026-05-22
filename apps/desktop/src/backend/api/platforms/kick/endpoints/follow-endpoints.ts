/**
 * Followed-channels fetch for the signed-in Kick user.
 *
 * The official Kick public API (api.kick.com/public/v1) has no followed-channels
 * endpoint — confirmed live against docs.kick.com on 2026-05-21. The only path
 * is the undocumented internal v2 endpoint at kick.com/api/v2/channels/followed.
 *
 * This module tries Bearer auth via `fetch()` first (cheapest path — mirrors
 * `kickAuthService.fetchCurrentUser`). If the v2 endpoint accepts the OAuth
 * Bearer token, no BrowserWindow / cookie-warming dance is needed. If it
 * rejects with 401/403 or returns a Cloudflare HTML challenge, this module
 * surfaces the failure class so a follow-up cookie-auth BrowserWindow path
 * can be added if needed.
 *
 * Returns a tagged result rather than throwing. Callers (notably
 * `syncFollowsOnLogin`) use the tag to decide whether to mutate the local
 * follow DB — a destructive `clearAccountFollows` must not fire on an `error`
 * outcome or transient failures would wipe a user's prior synced follows.
 */

import type { UnifiedChannel } from "../../../unified/platform-types";
import { transformKickFollowedChannelLegacy } from "../kick-transformers";
import type { KickLegacyApiFollowedChannel } from "../kick-types";
import { KICK_LEGACY_API_V2_BASE } from "../kick-types";

import { storageService } from "../../../../services/storage-service";

const FOLLOWED_CHANNELS_URL = `${KICK_LEGACY_API_V2_BASE}/channels/followed`;
const FETCH_TIMEOUT_MS = 10000;

export type FollowedChannelsResult =
  | { status: "ok"; channels: UnifiedChannel[] }
  | { status: "error"; reason: ErrorReason };

export type ErrorReason =
  | "no-token"
  | "auth-failed"
  | "parse-error"
  | "network-error"
  | "cloudflare-challenge";

// Single-flight guard. A second caller arriving while a fetch is in flight
// shares the same Promise rather than firing a duplicate request.
let _inFlight: Promise<FollowedChannelsResult> | null = null;

// Warn-once-per-session by failure class. Module-scoped Set lives until the
// main process restarts. Prevents log spam if `syncFollowsOnLogin` fires on
// every reconnect attempt during a flaky network. Matches the
// `_publicChannelWarnedSlugs` pattern in channel-endpoints.ts.
const _warned = new Set<ErrorReason>();

/**
 * Fetch the channels the signed-in Kick user follows on kick.com.
 *
 * Never throws. Returns `{ status: 'ok' }` with the imported channels (possibly
 * empty if the user follows zero channels) or `{ status: 'error', reason }`
 * with a classified failure. Callers should treat `error` as "do not mutate
 * the local DB" — preserving the user's last-known account-source rows under
 * transient failure is more important than freshness.
 */
export async function getAllFollowedChannels(): Promise<FollowedChannelsResult> {
  if (_inFlight) return _inFlight;
  _inFlight = _doFetch().finally(() => {
    _inFlight = null;
  });
  return _inFlight;
}

async function _doFetch(): Promise<FollowedChannelsResult> {
  const token = storageService.getToken("kick")?.accessToken;
  if (!token) {
    // No token = user not signed in. syncFollowsOnLogin guards this upstream,
    // but defending here lets callers reuse the function without that assumption.
    return { status: "error", reason: "no-token" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(FOLLOWED_CHANNELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    // Network-level failures (DNS, refused, abort). Debug-log only — these are
    // transient and re-fire on the next login. AbortError filtered out
    // explicitly so the warn channel doesn't get noise from rapid retriggers.
    if (err instanceof Error && err.name === "AbortError") {
      console.debug("[KickFollows] Fetch aborted (timeout or re-trigger)");
    } else {
      console.debug("[KickFollows] Network error:", err);
    }
    return { status: "error", reason: "network-error" };
  }
  clearTimeout(timeout);

  if (response.status === 401 || response.status === 403) {
    _warnOnce("auth-failed", `Kick v2 followed-channels rejected Bearer auth (status ${response.status}). If this persists, the endpoint may require session-cookie auth via BrowserWindow.`);
    return { status: "error", reason: "auth-failed" };
  }

  if (!response.ok) {
    // 5xx or other transient — debug only.
    console.debug(`[KickFollows] Non-2xx response: ${response.status}`);
    return { status: "error", reason: "network-error" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (err) {
    console.debug("[KickFollows] Response body read failed:", err);
    return { status: "error", reason: "network-error" };
  }

  // Detect Cloudflare challenge HTML before JSON parse — gives a clearer
  // failure class than a generic parse-error.
  const lower = body.toLowerCase();
  if (
    lower.includes("<!doctype html") ||
    lower.includes("just a moment") ||
    lower.includes("cf-browser-verification")
  ) {
    _warnOnce(
      "cloudflare-challenge",
      "Kick v2 followed-channels returned a Cloudflare challenge page. The endpoint likely requires session cookies from a kick.com browser context; a BrowserWindow fallback is needed."
    );
    return { status: "error", reason: "cloudflare-challenge" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    _warnOnce(
      "parse-error",
      `Kick v2 followed-channels returned non-JSON. Preview: ${body.slice(0, 120)}`
    );
    return { status: "error", reason: "parse-error" };
  }

  // Accept either `{ data: [...] }` (Laravel convention) or a top-level array.
  const rawItems = _extractItems(parsed);
  if (!rawItems) {
    _warnOnce(
      "parse-error",
      `Kick v2 followed-channels JSON did not contain an array under 'data' or at top level. Got: ${typeof parsed}`
    );
    return { status: "error", reason: "parse-error" };
  }

  const channels: UnifiedChannel[] = [];
  for (const item of rawItems) {
    const channel = transformKickFollowedChannelLegacy(item as KickLegacyApiFollowedChannel);
    if (channel) channels.push(channel);
  }

  // Empty list IS a valid outcome — user genuinely follows zero channels.
  // No warn. The caller (syncFollowsOnLogin) handles the clear+insert with
  // zero inserts as a successful sync.
  return { status: "ok", channels };
}

function _extractItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)) {
    return (parsed as { data: unknown[] }).data;
  }
  return null;
}

function _warnOnce(reason: ErrorReason, message: string): void {
  if (_warned.has(reason)) return;
  _warned.add(reason);
  console.warn(`[KickFollows] ${message}`);
}

/**
 * Test-only helper. Resets the warn-once Set so individual tests can assert
 * warn-fires on each scenario without ordering coupling.
 */
export function _resetWarnedForTests(): void {
  _warned.clear();
}
