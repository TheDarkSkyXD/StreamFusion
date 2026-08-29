/**
 * Followed-channels fetch for the signed-in Kick user.
 *
 * The official Kick public API (api.kick.com/public/v1) has no followed-channels
 * endpoint — confirmed live against docs.kick.com on 2026-05-21. The only path
 * is the undocumented internal full-page endpoint at
 * kick.com/api/v2/channels/followed-page. Kick's similarly named
 * /channels/followed endpoint is sidebar-scoped and is not authoritative.
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

import { session, type BrowserWindow } from "electron";
import { logger } from "@backend/logging/logger";
import {
  firstValidKickBroadcasterUserId,
  getKickBroadcasterUserIdFromAvatar,
} from "@/lib/kick-channel-identity";
import { hasCanonicalKickScopes } from "../../../../auth/kick-scope-validation";
import { storageService } from "../../../../services/storage-service";
import { waitForWebContentsCondition } from "../../../../services/web-contents-ready";
import type { UnifiedChannel } from "../../../../../shared/platform-types";
import { createHiddenKickBrowserWindow } from "../kick-hidden-browser-window";
import { installKickWebBearerCapture, readPersistedKickWebBearer } from "../kick-web-credential";
import { transformKickFollowedChannelLegacy } from "../kick-transformers";
import type { KickLegacyApiFollowedChannel } from "../kick-types";
import { KICK_LEGACY_API_V2_BASE } from "../kick-types";
import {
  fetchKickWebApiGet,
  fetchKickWebApiMutation,
  type KickWebApiGetResult,
  type KickWebApiMutationResult,
} from "../kick-send-window";
import { acquireBrowserWindowSlot } from "./channel-endpoints";
import { GRID_READY_PREDICATE } from "../follow-grid-predicate";

export { GRID_READY_PREDICATE } from "../follow-grid-predicate";

export const KICK_FOLLOWED_CHANNELS_API_PATH = "/api/v2/channels/followed";
export const KICK_FOLLOWED_CHANNELS_PAGE_API_PATH = "/api/v2/channels/followed-page";
const FOLLOWED_CHANNELS_URL = `${KICK_LEGACY_API_V2_BASE}/channels/followed`;
const FETCH_TIMEOUT_MS = 10000;

export type FollowedChannelsResult =
  | { status: "ok"; channels: UnifiedChannel[]; canPruneAbsent: boolean }
  | { status: "error"; reason: ErrorReason };

export type KickFollowWriteAction = "follow" | "unfollow";
export type KickFollowWriteResult =
  | { status: "ok" }
  | { status: "indeterminate"; reason: "http-422" }
  | { status: "error"; reason: "auth-failed" | "network-error" | "write-failed" };

export async function writeKickAccountFollow(request: {
  action: KickFollowWriteAction;
  channelSlug: string;
}): Promise<KickFollowWriteResult> {
  const slug = request.channelSlug.trim().toLowerCase();
  let result: KickWebApiMutationResult;
  try {
    result = await fetchKickWebApiMutation(
      request.action === "follow" ? "POST" : "DELETE",
      `/api/v2/channels/${encodeURIComponent(slug)}/follow`
    );
  } catch {
    return { status: "error", reason: "network-error" };
  }
  if (!result.ok) {
    // Kick's web follow route can answer 422 when the requested state is
    // already applied. The response alone is neither success nor failure;
    // the write service must confirm against a fresh followed-channel sync.
    if (result.status === 422) return { status: "indeterminate", reason: "http-422" };
    return {
      status: "error",
      reason:
        result.kind === "auth-expired"
          ? "auth-failed"
          : result.kind === "network"
            ? "network-error"
            : "write-failed",
    };
  }
  return { status: "ok" };
}

export type ErrorReason =
  | "no-token"
  | "auth-failed"
  | "web-session-required"
  | "kick-web-account-mismatch"
  | "parse-error"
  | "network-error"
  | "rate-limited"
  | "cloudflare-challenge";

interface FollowedChannelsOptions {
  allowBrowserWindowFallback?: boolean;
}

type ScrapedKickFollowedChannel = {
  slug: string;
  displayName: string;
  avatarUrl: string;
};

type BrowserFollowScan = {
  channels: ScrapedKickFollowedChannel[];
  scoped?: boolean;
  scrollSettled?: boolean;
  reachedScrollEnd?: boolean;
  loadingSettled?: boolean;
  dedicatedFollowingPage?: boolean;
  emptyStateVisible?: boolean;
};

export function interpretBrowserFollowScan(scan: BrowserFollowScan): FollowedChannelsResult {
  return {
    status: "ok",
    channels: scan.channels.map(mapScrapedKickFollowedChannel),
    canPruneAbsent: false,
  };
}

export function mapScrapedKickFollowedChannel(channel: ScrapedKickFollowedChannel): UnifiedChannel {
  const broadcasterUserId = firstValidKickBroadcasterUserId(
    getKickBroadcasterUserIdFromAvatar(channel.avatarUrl)
  );

  return {
    id: broadcasterUserId ?? channel.slug,
    platform: "kick",
    username: channel.slug,
    displayName: channel.displayName,
    avatarUrl: channel.avatarUrl,
    bannerUrl: undefined,
    bio: undefined,
    isLive: false,
    isVerified: false,
    isPartner: false,
    kickUserId: broadcasterUserId ?? undefined,
  };
}

function parseKickFollowedChannelsPayload(payload: unknown): UnifiedChannel[] | null {
  const rawItems = _extractItems(payload);
  if (!rawItems) return null;
  const channels: UnifiedChannel[] = [];
  for (const item of rawItems) {
    const channel = transformKickFollowedChannelLegacy(item as KickLegacyApiFollowedChannel);
    if (!channel) return null;
    channels.push(channel);
  }
  return channels;
}

type KickWebFollowPage = {
  channels: UnifiedChannel[];
  nextCursor: number;
  discardedRows: number;
};

function parseKickWebFollowPage(payload: unknown): KickWebFollowPage | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const nextCursor = record.nextCursor === undefined ? 0 : record.nextCursor;
  if (
    !Array.isArray(record.channels) ||
    typeof nextCursor !== "number" ||
    !Number.isSafeInteger(nextCursor) ||
    nextCursor < 0
  ) {
    return null;
  }
  const channels: UnifiedChannel[] = [];
  let discardedRows = 0;
  for (const value of record.channels) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      discardedRows += 1;
      continue;
    }
    const item = value as Record<string, unknown>;
    if (typeof item.channel_slug !== "string" || !item.channel_slug.trim()) {
      discardedRows += 1;
      continue;
    }
    const slug = item.channel_slug.trim().toLowerCase();
    const displayName =
      typeof item.user_username === "string" && item.user_username.trim()
        ? item.user_username
        : item.channel_slug;
    channels.push({
      id: slug,
      platform: "kick",
      username: slug,
      displayName,
      avatarUrl: typeof item.profile_picture === "string" ? item.profile_picture : "",
      bannerUrl: undefined,
      bio: undefined,
      isLive: item.is_live === true,
      isVerified: false,
      isPartner: false,
    });
  }
  return { channels, nextCursor, discardedRows };
}

function describePayloadShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      first: value.length > 0 ? describeObjectShape(value[0]) : undefined,
    };
  }
  return describeObjectShape(value);
}

function describeObjectShape(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return { type: typeof value };
  const object = value as Record<string, unknown>;
  return {
    type: "object",
    keys: Object.keys(object).sort(),
    fields: Object.fromEntries(
      Object.entries(object).map(([key, field]) => [
        key,
        Array.isArray(field)
          ? {
              type: "array",
              length: field.length,
              first: field.length > 0 ? describeObjectShape(field[0]) : undefined,
            }
          : typeof field === "object" && field !== null
            ? describeObjectShape(field)
            : { type: typeof field },
      ])
    ),
  };
}

// Single-flight guard. Requests share work only when they allow the same
// fallback behavior; an authoritative settlement must not inherit a weaker
// bearer-only request from a background refresh.
const _inFlightByFallback = new Map<boolean, Promise<FollowedChannelsResult>>();

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
export async function getAllFollowedChannels(
  options: FollowedChannelsOptions = {}
): Promise<FollowedChannelsResult> {
  const allowBrowserWindowFallback = options.allowBrowserWindowFallback === true;
  const existing = _inFlightByFallback.get(allowBrowserWindowFallback);
  if (existing) return existing;
  const request = _doFetch(options).finally(() => {
    if (_inFlightByFallback.get(allowBrowserWindowFallback) === request) {
      _inFlightByFallback.delete(allowBrowserWindowFallback);
    }
  });
  _inFlightByFallback.set(allowBrowserWindowFallback, request);
  return request;
}

async function _doFetch(options: FollowedChannelsOptions): Promise<FollowedChannelsResult> {
  const storedToken = storageService.getToken("kick");
  const token = hasCanonicalKickScopes(storedToken?.scope) ? storedToken?.accessToken : null;
  if (!token) {
    // No token = user not signed in. syncFollowsOnLogin guards this upstream,
    // but defending here lets callers reuse the function without that assumption.
    return { status: "error", reason: "no-token" };
  }

  const webSessionResult = await _tryWebSessionFetch();
  if (webSessionResult.status === "ok") {
    const pageResult = await _tryWebSessionFollowedPageFetch();
    if (pageResult.status !== "ok") return webSessionResult;
    const combined = new Map(
      webSessionResult.channels.map((channel) => [channel.username, channel] as const)
    );
    for (const channel of pageResult.channels) combined.set(channel.username, channel);
    return {
      status: "ok",
      channels: [...combined.values()],
      // Kick currently serves two distinct account-follow projections. Their
      // union discovers fresh follows, but absence is not authoritative until
      // relationship verification reconciles it against stored rows.
      canPruneAbsent: false,
    };
  }
  if (
    webSessionResult.reason === "rate-limited" ||
    webSessionResult.reason === "web-session-required" ||
    webSessionResult.reason === "kick-web-account-mismatch"
  ) {
    return webSessionResult;
  }

  const bearerResult = await _tryBearerFetch(token);
  if (bearerResult.status === "ok") return bearerResult;
  if (!options.allowBrowserWindowFallback) return bearerResult;

  // The Bearer path is cheap and does not spin up Chromium. If Kick rejects it
  // for this account/session, fall back to the cookie-auth BrowserWindow path.
  logger.debug(
    "Kick:Endpoints:Follow",
    "Using BrowserWindow cookie-auth fallback for followed channels",
    { reason: bearerResult.reason }
  );
  return _fetchViaBrowserWindow();
}

async function tryWebSessionFollowCollection(
  basePath: string,
  verifyViewer: boolean
): Promise<FollowedChannelsResult> {
  const collected = new Map<string, UnifiedChannel>();
  const seenCursors = new Set<number>();
  let discardedRows = 0;
  let pageCount = 0;
  let cursor: number | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    let response: KickWebApiGetResult;
    const params = new URLSearchParams();
    if (cursor !== undefined) params.set("cursor", String(cursor));
    const path = `${basePath}${params.size > 0 ? `?${params}` : ""}`;
    try {
      response = await fetchKickWebApiGet(path);
    } catch {
      logger.debug("Kick:Endpoints:Follow", "Kick web followed-list request threw");
      return { status: "error", reason: "network-error" };
    }
    logger.debug("Kick:Endpoints:Follow", "Kick web followed-list response", {
      ok: response.ok,
      status: response.status,
      kind: response.ok ? "ok" : response.kind,
    });
    if (!response.ok) {
      if (response.kind === "auth-expired" || response.status === 401 || response.status === 419) {
        return { status: "error", reason: "web-session-required" };
      }
      if (response.status === 429) {
        logger.debug("Kick:Endpoints:Follow", "Kick web followed-list rate limited", {
          retryAfterSeconds: response.retryAfterSeconds,
        });
        return { status: "error", reason: "rate-limited" };
      }
      logger.debug("Kick:Endpoints:Follow", "Kick web followed-list request failed", {
        status: response.status,
        retryAfterSeconds: response.retryAfterSeconds,
      });
      return { status: "error", reason: "network-error" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      logger.info("Kick:Endpoints:Follow", "Kick web followed-list parser rejected response", {
        outcome: "invalid-json",
      });
      return { status: "error", reason: "parse-error" };
    }
    const page = parseKickWebFollowPage(parsed);
    if (!page) {
      logger.warn("Kick:Endpoints:Follow", "Kick web followed-list parser rejected response", {
        outcome: "invalid-shape",
        shape: describePayloadShape(parsed),
      });
      return { status: "error", reason: "parse-error" };
    }
    logger.debug("Kick:Endpoints:Follow", "Kick web followed-list page parsed", {
      count: page.channels.length,
    });
    pageCount += 1;
    discardedRows += page.discardedRows;
    for (const channel of page.channels) collected.set(channel.username, channel);
    if (page.nextCursor === 0) break;
    if (seenCursors.has(page.nextCursor)) return { status: "error", reason: "parse-error" };
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
    if (pageIndex === 99) return { status: "error", reason: "parse-error" };
  }
  logger.info("Kick:Endpoints:Follow", "Kick followed-list collection completed", {
    pageCount,
    channelCount: collected.size,
    discardedRowCount: discardedRows,
    viewerVerificationRequired: verifyViewer,
  });
  if (!verifyViewer) {
    return { status: "ok", channels: [...collected.values()], canPruneAbsent: false };
  }
  const viewer = storageService.getKickUser();
  if (!viewer) return { status: "error", reason: "auth-failed" };
  const identity = await verifyKickWebViewerIdentity(viewer);
  if (identity !== "match") {
    return {
      status: "error",
      reason: identity === "mismatch" ? "kick-web-account-mismatch" : "web-session-required",
    };
  }
  return {
    status: "ok",
    channels: [...collected.values()],
    canPruneAbsent: discardedRows === 0,
  };
}

export function _tryWebSessionFetch(): Promise<FollowedChannelsResult> {
  return tryWebSessionFollowCollection(KICK_FOLLOWED_CHANNELS_API_PATH, true);
}

export function _tryWebSessionFollowedPageFetch(): Promise<FollowedChannelsResult> {
  return tryWebSessionFollowCollection(KICK_FOLLOWED_CHANNELS_PAGE_API_PATH, false);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readKickWebViewerIdentity(payload: unknown): { id: string; username: string } | null {
  if (!isUnknownRecord(payload)) return null;
  const data = isUnknownRecord(payload.data) ? payload.data : null;
  const candidates = [
    payload,
    data,
    isUnknownRecord(payload.user) ? payload.user : null,
    isUnknownRecord(data?.user) ? data.user : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const id = candidate.id;
    const username =
      typeof candidate.slug === "string"
        ? candidate.slug
        : typeof candidate.username === "string"
          ? candidate.username
          : null;
    if ((typeof id === "number" || typeof id === "string") && username?.trim()) {
      return { id: String(id), username: username.trim().toLowerCase() };
    }
  }
  return null;
}

export async function verifyKickWebViewerIdentity(viewer: {
  id: number;
  slug: string;
  username: string;
}): Promise<"match" | "mismatch" | "unavailable"> {
  let response: KickWebApiGetResult;
  try {
    response = await fetchKickWebApiGet("/api/v1/user");
  } catch {
    return "unavailable";
  }
  if (!response.ok) return response.kind === "auth-expired" ? "unavailable" : "unavailable";
  try {
    const parsed = JSON.parse(response.body) as unknown;
    const identity = readKickWebViewerIdentity(parsed);
    if (!identity) return "unavailable";
    return identity.id === String(viewer.id) &&
      identity.username === (viewer.slug || viewer.username).toLowerCase()
      ? "match"
      : "mismatch";
  } catch {
    return "unavailable";
  }
}

/**
 * Test-visible Bearer-fetch path. Exported (with underscore prefix) so unit
 * tests can validate the per-cause classification logic without mocking
 * Electron's BrowserWindow constructor. The orchestration in `_doFetch` is
 * validated by live integration testing — see plan task #6.
 */
export async function _tryBearerFetch(token: string): Promise<FollowedChannelsResult> {
  let response: Response;
  try {
    response = await fetch(FOLLOWED_CHANNELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // Network-level failures (DNS, refused, abort). Debug-log only — these are
    // transient and re-fire on the next login. AbortError/TimeoutError filtered
    // out explicitly so the warn channel doesn't get noise from rapid retriggers.
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      logger.debug("Kick:Endpoints:Follow", "Fetch aborted (timeout or re-trigger)");
    } else {
      logger.debug("Kick:Endpoints:Follow", "Network error", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
    }
    return { status: "error", reason: "network-error" };
  }

  if (response.status === 401 || response.status === 403) {
    logger.debug("Kick:Endpoints:Follow", "Kick v2 followed-channels rejected Bearer auth", {
      status: response.status,
    });
    return { status: "error", reason: "auth-failed" };
  }

  if (!response.ok) {
    // 5xx or other transient — debug only.
    logger.debug("Kick:Endpoints:Follow", "Non-2xx response", { status: response.status });
    return { status: "error", reason: "network-error" };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (err) {
    logger.debug("Kick:Endpoints:Follow", "Response body read failed", {
      error:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : String(err),
    });
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
  const channels = parseKickFollowedChannelsPayload(parsed);
  if (!channels) {
    _warnOnce(
      "parse-error",
      `Kick v2 followed-channels JSON did not contain an array under 'data' or at top level. Got: ${typeof parsed}`
    );
    return { status: "error", reason: "parse-error" };
  }

  // Empty list IS a valid outcome — user genuinely follows zero channels.
  // No warn. The caller (syncFollowsOnLogin) handles the clear+insert with
  // zero inserts as a successful sync.
  return { status: "ok", channels, canPruneAbsent: true };
}

const PAGE_LOAD_TIMEOUT_MS = 10000;
const KICK_DOCUMENT_READY_PREDICATE = `(() => {
  try {
    return location.protocol === 'https:' &&
      (location.hostname === 'kick.com' || location.hostname.endsWith('.kick.com')) &&
      (document.readyState === 'interactive' || document.readyState === 'complete') &&
      !!document.body;
  } catch { return false; }
})()`;

export function canRecoverKickRedirectAbort(error: unknown, documentReady: boolean): boolean {
  if (!documentReady || !(error instanceof Error)) return false;
  const code = "code" in error ? (error as Error & { code?: unknown }).code : undefined;
  return code === -3 || /ERR_ABORTED|\(-3\)/i.test(error.message);
}
// Outer cap on the scroll-and-scrape phase (wall clock). Bounds the worst
// case where a hung renderer / GPU stall / unending lazy-loader would hold
// `_inFlight` forever and wedge the BrowserWindow slot mutex.
const SCROLL_AND_SCRAPE_TIMEOUT_MS = 30_000;
export const KICK_FOLLOWING_CHANNELS_URL = "https://kick.com/following/channels";

export function buildKickFollowApiIIFE(path: string, bearer: string): string {
  const p = JSON.stringify(path);
  const b = JSON.stringify(bearer);
  return `(async () => {
    try {
      const response = await fetch(${p}, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Authorization": ${b},
          "Accept": "application/json",
          "Referer": "https://kick.com/",
          "X-App-Platform": "web",
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      return JSON.stringify({ status: response.status, body: await response.text() });
    } catch (error) {
      return JSON.stringify({ status: 0, body: String(error) });
    }
  })()`;
}

async function fetchFollowedChannelsFromPageApi(
  win: BrowserWindow,
  bearer: string
): Promise<FollowedChannelsResult> {
  const request = async (path: string): Promise<{ status: number; body: string } | null> => {
    try {
      const raw = (await win.webContents.executeJavaScript(
        buildKickFollowApiIIFE(path, bearer)
      )) as string;
      const envelope = JSON.parse(raw) as unknown;
      if (typeof envelope !== "object" || envelope === null) return null;
      const record = envelope as Record<string, unknown>;
      return typeof record.status === "number" && typeof record.body === "string"
        ? { status: record.status, body: record.body }
        : null;
    } catch {
      return null;
    }
  };

  const collected = new Map<string, UnifiedChannel>();
  const seenCursors = new Set<number>();
  let cursor: number | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const params = new URLSearchParams();
    if (cursor !== undefined) params.set("cursor", String(cursor));
    const response = await request(
      `${KICK_FOLLOWED_CHANNELS_API_PATH}${params.size > 0 ? `?${params}` : ""}`
    );
    if (!response || response.status < 200 || response.status >= 300) {
      return {
        status: "error",
        reason: response?.status === 401 ? "auth-failed" : "network-error",
      };
    }
    let page: KickWebFollowPage | null;
    try {
      page = parseKickWebFollowPage(JSON.parse(response.body));
    } catch {
      page = null;
    }
    if (!page) return { status: "error", reason: "parse-error" };
    for (const channel of page.channels) collected.set(channel.username, channel);
    if (page.nextCursor === 0) break;
    if (seenCursors.has(page.nextCursor)) return { status: "error", reason: "parse-error" };
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
    if (pageIndex === 99) return { status: "error", reason: "parse-error" };
  }

  const viewer = storageService.getKickUser();
  if (!viewer) return { status: "error", reason: "auth-failed" };
  const identityResponse = await request("/api/v1/user");
  if (!identityResponse || identityResponse.status < 200 || identityResponse.status >= 300) {
    return { status: "error", reason: "auth-failed" };
  }
  try {
    const identity = readKickWebViewerIdentity(JSON.parse(identityResponse.body) as unknown);
    if (
      !identity ||
      identity.id !== String(viewer.id) ||
      identity.username !== (viewer.slug || viewer.username).toLowerCase()
    ) {
      return { status: "error", reason: "kick-web-account-mismatch" };
    }
  } catch {
    return { status: "error", reason: "parse-error" };
  }

  return { status: "ok", channels: [...collected.values()], canPruneAbsent: true };
}

/**
 * Page-context script that scrolls the kick.com/following/channels list and
 * collects channels DURING each scroll step (not after). kick.com's grid
 * lazy-renders ~20 cards per viewport, and may virtualize (unmount off-screen
 * cards). Collecting at each step accumulates the full list into a Map keyed
 * by slug regardless of whether earlier cards are still mounted by the end.
 *
 * Terminates only after the collected set and document height are stable, the
 * viewport is at the actual scroll end, and loading indicators are gone; the
 * hard round cap remains a non-authoritative escape hatch.
 */
const SCROLL_AND_SCRAPE = `(async () => {
  // timer-allowlist: page-context script literal — runs inside kick.com via executeJavaScript
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STABLE_ROUNDS = 3;
  const MAX_ROUNDS = 80;
  const SCROLL_DELAY_MS = 350;

  const reservedPaths = new Set([
    'login','signup','signin','signout','logout','about','help',
    'dashboard','settings','profile','admin','browse','category',
    'categories','games','search','following','followers','vods',
    'clips','subscriptions','community','dmca','privacy','terms',
    'rules','features','app','schedule','wallet','partner','support',
  ]);

  const findScope = () => {
    for (const h of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
      const text = (h.textContent || '').trim().toLowerCase();
      if (/^(following|followed channels|channels you follow|following channels)$/.test(text)) {
        let p = h.parentElement;
        for (let i = 0; i < 6 && p; i++) {
          const includesRecommendations = Array.from(
            p.querySelectorAll('h1, h2, h3, [role="heading"]')
          ).some((candidate) => /^live channels$/i.test((candidate.textContent || '').trim()));
          const hasFollowCard = p.querySelectorAll('a[href] img').length >= 1;
          const hasEmptyState = /(?:aren't|are not|not following|no followed channels|don't follow any channels)/i.test(p.textContent || '');
          if (!includesRecommendations && (hasFollowCard || hasEmptyState)) return p;
          p = p.parentElement;
        }
      }
    }
    return null;
  };

  const seen = new Map();
  // Returns the number of slugs that were newly added on this pass.
  const collect = () => {
    const root = findScope();
    if (!root) return 0;
    const anchors = root.querySelectorAll('a[href]');
    let added = 0;
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/^\\/([^\\/?#]+)\\/?$/);
      if (!m) continue;
      const slug = m[1].toLowerCase();
      if (reservedPaths.has(slug)) continue;
      if (!/^[a-z0-9_-]{2,}$/.test(slug)) continue;
      const img = a.querySelector('img');
      if (!img) continue;
      const alt = (img.alt || '').trim();
      const src = img.getAttribute('src') || '';
      const existing = seen.get(slug);
      if (!existing) {
        seen.set(slug, { slug, displayName: (alt || slug).slice(0, 100), avatarUrl: src, _altLen: alt.length });
        added += 1;
      } else if (alt.length < existing._altLen) {
        seen.set(slug, { slug, displayName: (alt || slug).slice(0, 100), avatarUrl: src, _altLen: alt.length });
      }
    }
    return added;
  };

  const getScrollTarget = () => {
    let node = findScope();
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (
        node.scrollHeight > node.clientHeight + 2 &&
        /^(auto|scroll)$/.test(style.overflowY)
      ) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const scrollMetrics = (target) => ({
    top: target.scrollTop,
    height: target.scrollHeight,
    viewport: target.clientHeight || window.innerHeight,
  });

  collect();
  let stable = 0;
  let heightStable = 0;
  let rounds = 0;
  let scrollTarget = getScrollTarget();
  let previousHeight = scrollMetrics(scrollTarget).height;
  let reachedScrollEnd = false;
  let loadingSettled = false;
  while (rounds < MAX_ROUNDS) {
    const before = scrollMetrics(scrollTarget);
    scrollTarget.scrollTop = Math.min(
      before.top + Math.max(1, Math.floor(before.viewport * 0.8)),
      before.height
    );
    await sleep(SCROLL_DELAY_MS);
    const added = collect();
    if (added > 0) {
      stable = 0;
    } else {
      stable += 1;
    }
    const currentTarget = getScrollTarget();
    if (currentTarget !== scrollTarget) scrollTarget = currentTarget;
    const current = scrollMetrics(scrollTarget);
    const currentHeight = current.height;
    heightStable = currentHeight === previousHeight ? heightStable + 1 : 0;
    previousHeight = currentHeight;
    reachedScrollEnd = current.top + current.viewport >= currentHeight - 2;
    const scope = findScope();
    loadingSettled = !!scope &&
      !scope.querySelector('[aria-busy="true"], [role="progressbar"]') &&
      !/(?:loading|load more)/i.test(scope.textContent || '');
    rounds += 1;
    if (
      stable >= STABLE_ROUNDS &&
      heightStable >= STABLE_ROUNDS &&
      reachedScrollEnd &&
      loadingSettled
    ) break;
  }

  for (const v of seen.values()) delete v._altLen;

  const headings = [];
  for (const h of document.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
    const text = (h.textContent || '').trim().slice(0, 80);
    if (text) headings.push({ tag: h.tagName, text });
    if (headings.length >= 20) break;
  }
  const navLinks = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    const text = (a.textContent || '').trim().slice(0, 40);
    if (/follow/i.test(href) && href !== '/following') {
      navLinks.push({ href, text });
      if (navLinks.length >= 10) break;
    }
  }

  const scope = findScope();
  const followSections = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
    .filter((heading) => /follow|live channels/i.test((heading.textContent || '').trim()))
    .slice(0, 12)
    .map((heading) => {
      const ancestors = [];
      let node = heading.parentElement;
      for (let depth = 0; depth < 5 && node; depth += 1, node = node.parentElement) {
        ancestors.push({
          tag: node.tagName.toLowerCase(),
          testid: node.getAttribute('data-testid') || null,
          role: node.getAttribute('role') || null,
          anchors: node.querySelectorAll('a[href]').length,
          images: node.querySelectorAll('img').length,
          hasLiveHeading: Array.from(node.querySelectorAll('h1,h2,h3,[role="heading"]'))
            .some((candidate) => /^live channels$/i.test((candidate.textContent || '').trim())),
        });
      }
      return {
        kind: /^live channels$/i.test((heading.textContent || '').trim()) ? 'live-channels' : 'following',
        tag: heading.tagName.toLowerCase(),
        ancestors,
      };
    });
  const followResourcePaths = Array.from(performance.getEntriesByType('resource'))
    .map((entry) => {
      try { return new URL(entry.name).pathname; } catch { return ''; }
    })
    .filter((path) => /follow/i.test(path))
    .filter((path, index, all) => path && all.indexOf(path) === index)
    .slice(0, 20);
  return JSON.stringify({
    channels: Array.from(seen.values()),
    url: window.location.href,
    title: document.title,
    anchorCount: document.querySelectorAll('a[href]').length,
    cardCount: document.querySelectorAll('a[href]').length,
    acceptedCardCount: seen.size,
    channelCount: seen.size,
    sectionTestids: [],
    headings,
    navLinks,
    followSections,
    followResourcePaths,
    scoped: !!scope,
    scrollRounds: rounds,
    scrollSettled: stable >= STABLE_ROUNDS && heightStable >= STABLE_ROUNDS,
    reachedScrollEnd,
    loadingSettled,
    emptyStateVisible: !!scope && /(?:aren't|are not|not following|no followed channels|don't follow any channels)/i.test(scope.textContent || ''),
    dedicatedFollowingPage:
      window.location.pathname === '/following/channels' ||
      window.location.pathname === '/following/channels/',
  });
})()`;

/**
 * Cookie-auth fallback path: open a hidden BrowserWindow in the DEFAULT
 * Electron session (where the Kick OAuth window's id.kick.com cookies live),
 * navigate straight to the dedicated following page, and scrape channel info
 * from the rendered DOM.
 *
 * The default session is intentional — `persist:kick_public` doesn't carry
 * the user's authentication state (OAuth ran in default), and forcing a
 * partition migration would require every existing user to re-login.
 *
 * Mutex-serialized via `acquireBrowserWindowSlot` so we never contend with
 * `getPublicChannel` for the GPU subprocess.
 */
async function _fetchViaBrowserWindow(): Promise<FollowedChannelsResult> {
  // Normal-flow traces go to debug. Only actual failures emit warn so the
  // user's log file stays signal-dense.
  logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: acquiring window slot");
  const releaseSlot = await acquireBrowserWindowSlot();
  logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: slot acquired, creating window");
  let win: BrowserWindow | null = null;
  let pageBearer = readPersistedKickWebBearer();
  try {
    installKickWebBearerCapture(session.defaultSession, (bearer) => {
      pageBearer = bearer;
    });
    win = createHiddenKickBrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Match the Kick OAuth window. Kasada's session bootstrap does not
        // complete reliably in Electron's sandboxed renderer.
        sandbox: false,
        // Default session — inherits OAuth window's id.kick.com cookies.
      },
    });

    const defaultSession = session.defaultSession;
    const cookies = await defaultSession.cookies.get({ domain: "kick.com" });
    const cookieSummary = cookies.map((c) => `${c.name}@${c.domain}`).join(", ") || "(none)";
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: kick.com cookies before scrape",
      {
        cookieSummary,
      }
    );

    // Fetch the v2 endpoint FROM INSIDE the kick.com page context, NOT via
    // a direct loadURL. Laravel's session middleware requires a matching
    // X-XSRF-TOKEN header (value sourced from the XSRF-TOKEN cookie) on
    // session-authenticated API requests; direct top-level navigation
    // doesn't send that header, which is why earlier test runs got
    // {"message":"Unauthenticated."} even with all session cookies present.
    // The page-context fetch reads the XSRF cookie and attaches the header,
    // mirroring what kick.com's SPA does for its own API calls. Also sends
    // X-Requested-With so Laravel respects Accept: application/json instead
    // of redirecting an unauthed request to /login.
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: fetching followed-channels URL via page context with XSRF header",
      { url: FOLLOWED_CHANNELS_URL }
    );

    // Programmatic API fetches consistently fail against Kick's v2 endpoint
    // (live-tested 2026-05-22: kick.com 401 even with full session cookies +
    // XSRF header + AJAX-Requested header; web.kick.com cross-origin
    // blocked). The SPA itself loads the user's follows just fine on
    // kick.com/following because its own context has Kasada's bot-detection
    // tokens injected. We piggyback on that: navigate the BrowserWindow to
    // the /following page, wait for the SPA to render the follows grid,
    // then scrape channel info from the rendered DOM.
    // /following is a hybrid view that mixes "live follows" + "Live Channels"
    // (general recommendations). /following/channels is the dedicated user-
    // follows page exposed in the page's own navigation. Live-diagnostic on
    // 2026-05-22: /following heading hierarchy = [H2:Following, H2:Live Channels]
    // with nav link [Channels → /following/channels]. Scrape the dedicated
    // page so we don't mix recommendations into the follow list.
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: navigating to followed-channels page for DOM-scrape extraction",
      { url: KICK_FOLLOWING_CHANNELS_URL }
    );

    try {
      const navPromise = win.loadURL(KICK_FOLLOWING_CHANNELS_URL);
      const navTimeout = new Promise<never>((_, reject) =>
        // timer-allowlist: Promise.race page-load nav-timeout (SP3 out-of-scope)
        setTimeout(() => reject(new Error("following-page-load-timeout")), PAGE_LOAD_TIMEOUT_MS)
      );
      await Promise.race([navPromise, navTimeout]);
      logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: /following page loaded");
    } catch (err) {
      // Real failure — keep at warn. Deduped via _warnOnce so reconnect
      // loops don't spam the log.
      const documentReady =
        !win.isDestroyed() &&
        !win.webContents.isDestroyed() &&
        (await waitForWebContentsCondition(win.webContents, KICK_DOCUMENT_READY_PREDICATE, {
          timeoutMs: PAGE_LOAD_TIMEOUT_MS,
        }));
      if (canRecoverKickRedirectAbort(err, documentReady)) {
        logger.debug(
          "Kick:Endpoints:Follow",
          "BrowserWindow fallback: redirect abort settled on a ready Kick document"
        );
      } else {
        _warnOnce(
          "network-error",
          `BrowserWindow fallback: /following navigation failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return { status: "error", reason: "network-error" };
      }
    }

    pageBearer = pageBearer ?? readPersistedKickWebBearer();
    if (!pageBearer) return { status: "error", reason: "auth-failed" };
    const apiResult = await fetchFollowedChannelsFromPageApi(win, pageBearer);
    logger.debug(
      "Kick:Endpoints:Follow",
      apiResult.status === "ok"
        ? "BrowserWindow fallback SUCCESS: fetched followed channels through page API"
        : "BrowserWindow page API unavailable",
      apiResult.status === "ok"
        ? { channelCount: apiResult.channels.length }
        : { reason: apiResult.reason }
    );
    return apiResult;

    // Wait for the SPA to render the follows grid rather than guessing a fixed
    // delay. Resolves as soon as the grid is present (typically < 6s); a slow
    // render is covered up to the 8s cap; a zero-follow account never populates
    // the grid, so the poll hits the cap and the scrape below returns empty
    // (same outcome as the old flat wait). Return value intentionally ignored —
    // the scrape runs either way.
    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback: waiting for /following grid to render"
    );
    await waitForWebContentsCondition(win!.webContents, GRID_READY_PREDICATE, {
      timeoutMs: 8000,
    });

    // Scroll + collect-during-scroll in a single page-context script.
    // kick.com/following/channels uses a virtualized/lazy-loaded list — first
    // paint only renders ~20 cards regardless of how many channels the user
    // follows. Collecting at each scroll step accumulates the full list
    // regardless of whether earlier cards are still mounted by the end.
    let scrapeResult: string;
    try {
      const scrapePromise = win!.webContents.executeJavaScript(SCROLL_AND_SCRAPE);
      const scrapeTimeout = new Promise<never>((_, reject) =>
        // timer-allowlist: Promise.race wall-clock cap on executeJavaScript (scroll+scrape)
        setTimeout(
          () => reject(new Error("scroll-and-scrape-timeout")),
          SCROLL_AND_SCRAPE_TIMEOUT_MS
        )
      );
      scrapeResult = (await Promise.race([scrapePromise, scrapeTimeout])) as string;
    } catch (err) {
      _warnOnce("parse-error", `BrowserWindow fallback: DOM scrape threw: ${String(err)}`);
      return { status: "error", reason: "parse-error" };
    }

    let scraped: {
      channels: Array<{ slug: string; displayName: string; avatarUrl: string }>;
      url: string;
      title: string;
      anchorCount: number;
      cardCount: number;
      acceptedCardCount: number;
      channelCount: number;
      sectionTestids: string[];
      headings: Array<{ tag: string; text: string }>;
      navLinks: Array<{ href: string; text: string }>;
      followSections?: Array<{
        kind: "following" | "live-channels";
        tag: string;
        ancestors: Array<{
          tag: string;
          testid: string | null;
          role: string | null;
          anchors: number;
          images: number;
          hasLiveHeading: boolean;
        }>;
      }>;
      followResourcePaths?: string[];
      scoped?: boolean;
      scrollRounds?: number;
      scrollSettled?: boolean;
      reachedScrollEnd?: boolean;
      loadingSettled?: boolean;
      emptyStateVisible?: boolean;
      dedicatedFollowingPage?: boolean;
    };
    try {
      scraped = JSON.parse(scrapeResult);
    } catch (err) {
      _warnOnce(
        "parse-error",
        `BrowserWindow fallback: DOM scrape result was not JSON: ${scrapeResult.slice(0, 200)}`
      );
      return { status: "error", reason: "parse-error" };
    }

    logger.debug("Kick:Endpoints:Follow", "BrowserWindow fallback: scraped result", {
      url: scraped.url,
      title: scraped.title,
      cards: scraped.cardCount,
      accepted: scraped.acceptedCardCount,
      channels: scraped.channelCount,
      scrollRounds: scraped.scrollRounds ?? "?",
      scrollSettled: scraped.scrollSettled ?? "?",
      sectionTestids: scraped.sectionTestids,
      followSections: scraped.followSections,
      followResourcePaths: scraped.followResourcePaths,
    });
    logger.debug("Kick:Endpoints:Follow", "Page headings", {
      headings: scraped.headings.map((h) => `${h.tag}:${h.text}`),
    });
    logger.debug("Kick:Endpoints:Follow", "Follow-related nav links", {
      navLinks: scraped.navLinks.map((l) => `${l.text}→${l.href}`),
    });

    const result = interpretBrowserFollowScan(scraped);
    if (result.status === "error") {
      _warnOnce(
        "parse-error",
        `Kick /following DOM scrape did not prove a valid follow-list result. Page url=${scraped.url}, title="${scraped.title}", anchor count=${scraped.anchorCount}.`
      );
      return result;
    }

    // The DB enforces UNIQUE(platform, channel_id, source). Empty channelId
    // would collide across all rows after the first, dropping 21 of 22
    // Prefer the stable broadcaster id embedded in Kick's canonical avatar
    // path. The mapper falls back to the slug when that identity is absent.
    const channels = (result as { channels: UnifiedChannel[] }).channels;

    logger.debug(
      "Kick:Endpoints:Follow",
      "BrowserWindow fallback SUCCESS: scraped followed channels from /following DOM",
      { channelCount: channels.length }
    );
    return result;
  } catch (err) {
    _warnOnce(
      "network-error",
      `BrowserWindow fallback unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return { status: "error", reason: "network-error" };
  } finally {
    releaseSlot();
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }
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
  logger.warn("Kick:Endpoints:Follow", message, { reason });
}

/**
 * Test-only helper. Resets the warn-once Set so individual tests can assert
 * warn-fires on each scenario without ordering coupling.
 */
export function _resetWarnedForTests(): void {
  _warned.clear();
}
