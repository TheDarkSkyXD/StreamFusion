import { createHash } from "node:crypto";

import type { Session } from "electron";

import { logger } from "@backend/logging/logger";

type ResourceType =
  | "mainFrame"
  | "subFrame"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "object"
  | "xhr"
  | "ping"
  | "cspReport"
  | "media"
  | "webSocket"
  | "other";

type SendDetails = {
  id: number;
  url: string;
  method: string;
  resourceType: ResourceType;
  referrer: string;
  timestamp: number;
  requestHeaders?: Record<string, string>;
};

type CompleteDetails = SendDetails & {
  fromCache: boolean;
  responseHeaders?: Record<string, string[]>;
  statusCode: number;
  statusLine: string;
  error: string;
};

type ErrorDetails = SendDetails & {
  fromCache: boolean;
  error: string;
};

type RequestStart = {
  devtoolsHint?: DevtoolsNetworkRequestHint;
  host: string;
  initiator: string;
  method: string;
  requestHeaders: Record<string, string>;
  resourceType: ResourceType;
  startedAt: number;
  url: string;
};

type RecentPlaylistFailure = {
  lastSeenAt: number;
};

export type DevtoolsNetworkRequestHint = {
  generatedInitiator?: string;
  generatedInitiatorColumn?: number;
  generatedInitiatorLine?: number;
  generatedInitiatorUrl?: string;
  initiator: string;
  initiatorColumn?: number;
  initiatorFunction?: string;
  initiatorLine?: number;
  initiatorType: string;
  initiatorUrl?: string;
  requestHeaders?: Record<string, string>;
  sourceMappedInitiator?: boolean;
  timestamp: number;
  urlFingerprint: string;
};

const installedSessions = new WeakSet<Session>();
const requestStartsBySession = new WeakMap<Session, Map<number, RequestStart>>();
const recentKickPlaylist404sBySession = new WeakMap<Session, Map<string, RecentPlaylistFailure>>();
const devtoolsHintsByFingerprint = new Map<string, DevtoolsNetworkRequestHint>();

const STREAM_HOST_PARTS = [
  "playlist.live-video.net",
  "live-video.net",
  "ttvnw.net",
  "jtvnw.net",
  "usher.ttvnw.net",
  "cloudfront.net",
  "amazonaws.com",
  "kick.com",
];

const STREAM_PATH_PATTERN = /\.(m3u8|mp4|m4s|ts|aac|vtt|key)(?:$|[?#])/i;
const PLAYLIST_PATH_PATTERN = /\.m3u8(?:$|[?#])/i;
const KICK_PLAYLIST_HOST_PARTS = ["playback.live-video.net", "playlist.live-video.net"];
const KICK_PLAYLIST_404_QUIET_PERIOD_MS = 30_000;
const SLOW_STREAM_REQUEST_MS = 2500;
const MAX_TRACKED_REQUESTS = 5000;
const CURL_HEADER_ALLOWLIST = new Set([
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "user-agent",
]);

function safeUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function hasStreamHost(host: string): boolean {
  return STREAM_HOST_PARTS.some((part) => host === part || host.endsWith(`.${part}`));
}

function isStreamRequestUrl(rawUrl: string): boolean {
  const url = safeUrl(rawUrl);
  if (url == null || !["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (PLAYLIST_PATH_PATTERN.test(path)) return true;
  if ((hasStreamHost(host) || host.includes("ivs")) && STREAM_PATH_PATTERN.test(path)) return true;
  if (host.includes("amazon-ivs") || path.includes("/ivs/")) return true;

  return false;
}

function requestKind(rawUrl: string): "playlist" | "segment" | "websocket" | "media" {
  const url = safeUrl(rawUrl);
  if (url?.protocol === "ws:" || url?.protocol === "wss:") return "websocket";
  if (url != null && PLAYLIST_PATH_PATTERN.test(url.pathname)) return "playlist";
  if (url != null && /\.(m4s|ts|aac)(?:$|[?#])/i.test(url.pathname)) return "segment";
  return "media";
}

function isUnavailableTwitchLiveManifest(rawUrl: string, statusCode: number): boolean {
  if (statusCode !== 404 && statusCode !== 410) return false;
  const url = safeUrl(rawUrl);
  return (
    url?.hostname.toLowerCase() === "usher.ttvnw.net" &&
    /^\/api\/(?:v2\/)?channel\/(?:hls\/)?[^/]+\.m3u8$/i.test(url.pathname)
  );
}

function kickPlaylistIdentity(rawUrl: string): string | null {
  const url = safeUrl(rawUrl);
  if (
    url == null ||
    !["http:", "https:"].includes(url.protocol) ||
    !KICK_PLAYLIST_HOST_PARTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    ) ||
    !PLAYLIST_PATH_PATTERN.test(url.pathname)
  ) {
    return null;
  }

  return urlFingerprint(`${url.origin}${url.pathname}`);
}

function trimRecentPlaylistFailures(failures: Map<string, RecentPlaylistFailure>): void {
  if (failures.size <= MAX_TRACKED_REQUESTS) return;

  let oldestIdentity: string | undefined;
  let oldestSeenAt = Number.POSITIVE_INFINITY;
  for (const [identity, failure] of failures) {
    if (failure.lastSeenAt < oldestSeenAt) {
      oldestIdentity = identity;
      oldestSeenAt = failure.lastSeenAt;
    }
  }
  if (oldestIdentity !== undefined) failures.delete(oldestIdentity);
}

function isRepeatedKickPlaylist404(targetSession: Session, details: CompleteDetails): boolean {
  const identity = kickPlaylistIdentity(details.url);
  if (identity == null) return false;

  const recentFailures = recentKickPlaylist404sBySession.get(targetSession);
  if (details.statusCode < 400) {
    recentFailures?.delete(identity);
    return false;
  }
  if (details.statusCode !== 404) return false;

  const previousFailure = recentFailures?.get(identity);
  const timeSincePreviousFailure =
    previousFailure == null
      ? Number.POSITIVE_INFINITY
      : details.timestamp - previousFailure.lastSeenAt;
  const isRepeated =
    timeSincePreviousFailure >= 0 && timeSincePreviousFailure < KICK_PLAYLIST_404_QUIET_PERIOD_MS;

  const failures = recentFailures ?? new Map<string, RecentPlaylistFailure>();
  failures.set(identity, { lastSeenAt: details.timestamp });
  recentKickPlaylist404sBySession.set(targetSession, failures);
  trimRecentPlaylistFailures(failures);
  return isRepeated;
}

function requestName(rawUrl: string): string {
  const redacted = redactedUrl(rawUrl);
  const url = safeUrl(redacted);
  if (url == null) return redacted;
  const finalSegment = url.pathname.split("/").filter(Boolean).at(-1);
  return finalSegment ?? url.hostname;
}

function redactedUrl(rawUrl: string): string {
  const url = safeUrl(rawUrl);
  if (url == null) return "[invalid-url]";

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return `${url.protocol}//${url.hostname}/`;

  const last = segments[segments.length - 1] ?? "";
  const extensionMatch = /\.([a-z0-9]+)$/i.exec(last);
  const extension = extensionMatch?.[0] ?? "";
  const keepPrefix = segments.slice(0, Math.min(2, Math.max(1, segments.length - 1)));
  const redactedTail = last.length > 48 ? `[REDACTED]${extension}` : last;
  const pathname = `/${[...keepPrefix, redactedTail].join("/")}`;

  return `${url.protocol}//${url.hostname}${pathname}`;
}

function urlFingerprint(rawUrl: string): string {
  return createHash("sha256").update(rawUrl).digest("hex").slice(0, 16);
}

export function networkRequestUrlFingerprint(rawUrl: string): string {
  return urlFingerprint(rawUrl);
}

export function isNetworkStreamRequestUrl(rawUrl: string): boolean {
  return isStreamRequestUrl(rawUrl);
}

export function recordDevtoolsNetworkRequestHint(hint: DevtoolsNetworkRequestHint): void {
  devtoolsHintsByFingerprint.set(hint.urlFingerprint, {
    ...hint,
    requestHeaders: sanitizedCurlHeaders(hint.requestHeaders),
  });
  if (devtoolsHintsByFingerprint.size <= MAX_TRACKED_REQUESTS) return;
  const first = devtoolsHintsByFingerprint.keys().next().value;
  if (typeof first === "string") devtoolsHintsByFingerprint.delete(first);
}

function sanitizedCurlHeaders(headers?: Record<string, string>): Record<string, string> {
  const safeHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (CURL_HEADER_ALLOWLIST.has(name.toLowerCase())) {
      safeHeaders[name] = value;
    }
  }
  return safeHeaders;
}

function contentLengthBytes(headers?: Record<string, string[]>): number | undefined {
  if (headers == null) return undefined;
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-length");
  const value = key == null ? undefined : headers[key]?.[0];
  if (value == null) return undefined;
  const size = Number.parseInt(value, 10);
  return Number.isFinite(size) && size >= 0 ? size : undefined;
}

function baseMeta(details: SendDetails, start?: RequestStart): Record<string, unknown> {
  const url = safeUrl(details.url);
  const kind = requestKind(details.url);
  const hint = start?.devtoolsHint;
  return {
    host: url?.hostname ?? "",
    initiator: hint?.initiator ?? start?.initiator ?? details.referrer,
    initiatorColumn: hint?.initiatorColumn,
    initiatorFunction: hint?.initiatorFunction,
    initiatorLine: hint?.initiatorLine,
    initiatorType: hint?.initiatorType,
    initiatorUrl: hint?.initiatorUrl,
    generatedInitiator: hint?.generatedInitiator,
    generatedInitiatorColumn: hint?.generatedInitiatorColumn,
    generatedInitiatorLine: hint?.generatedInitiatorLine,
    generatedInitiatorUrl: hint?.generatedInitiatorUrl,
    sourceMappedInitiator: hint?.sourceMappedInitiator,
    name: requestName(details.url),
    method: details.method,
    requestHeaders:
      start?.requestHeaders ?? hint?.requestHeaders ?? sanitizedCurlHeaders(details.requestHeaders),
    resourceType: details.resourceType,
    kind,
    type: `${kind}/${details.resourceType}`,
    url: start?.url ?? redactedUrl(details.url),
    urlFingerprint: urlFingerprint(details.url),
  };
}

function durationMs(details: SendDetails, start?: RequestStart): number | undefined {
  const startedAt = start?.startedAt ?? details.timestamp;
  if (!Number.isFinite(startedAt) || !Number.isFinite(details.timestamp)) return undefined;
  return Math.max(0, Math.round(details.timestamp - startedAt));
}

function getSessionStarts(targetSession: Session): Map<number, RequestStart> {
  let starts = requestStartsBySession.get(targetSession);
  if (starts == null) {
    starts = new Map<number, RequestStart>();
    requestStartsBySession.set(targetSession, starts);
  }
  return starts;
}

function trimTrackedRequests(starts: Map<number, RequestStart>): void {
  if (starts.size <= MAX_TRACKED_REQUESTS) return;
  const overflow = starts.size - MAX_TRACKED_REQUESTS;
  let removed = 0;
  for (const id of starts.keys()) {
    starts.delete(id);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export function installNetworkRequestLogger(targetSession: Session): void {
  if (installedSessions.has(targetSession)) return;
  installedSessions.add(targetSession);

  const starts = getSessionStarts(targetSession);
  const filter = { urls: ["<all_urls>"] };

  targetSession.webRequest.onSendHeaders(filter, (details: SendDetails) => {
    if (!isStreamRequestUrl(details.url)) return;
    const url = safeUrl(details.url);
    const fingerprint = urlFingerprint(details.url);
    const devtoolsHint = devtoolsHintsByFingerprint.get(fingerprint);
    const safeHeaders = sanitizedCurlHeaders(details.requestHeaders);
    starts.set(details.id, {
      devtoolsHint,
      host: url?.hostname ?? "",
      initiator: details.referrer,
      method: details.method,
      requestHeaders:
        Object.keys(safeHeaders).length > 0 ? safeHeaders : (devtoolsHint?.requestHeaders ?? {}),
      resourceType: details.resourceType,
      startedAt: details.timestamp,
      url: redactedUrl(details.url),
    });
    trimTrackedRequests(starts);
  });

  targetSession.webRequest.onCompleted(filter, (details: CompleteDetails) => {
    if (!isStreamRequestUrl(details.url)) return;

    const start = starts.get(details.id);
    starts.delete(details.id);

    const elapsed = durationMs(details, start);
    const meta = {
      ...baseMeta(details, start),
      sizeBytes: contentLengthBytes(details.responseHeaders),
      status: String(details.statusCode),
      statusCode: details.statusCode,
      fromCache: details.fromCache,
      durationMs: elapsed,
    };

    if (details.statusCode >= 400) {
      if (isUnavailableTwitchLiveManifest(details.url, details.statusCode)) {
        logger.info("Network:Request", "Twitch live manifest unavailable", meta);
        return;
      }
      if (isRepeatedKickPlaylist404(targetSession, details)) return;
      logger.error("Network:Request", "stream request failed with HTTP status", meta);
      return;
    }

    isRepeatedKickPlaylist404(targetSession, details);

    if (elapsed !== undefined && elapsed >= SLOW_STREAM_REQUEST_MS) {
      logger.warn("Network:Request", "stream request slow", meta);
      return;
    }

    if (requestKind(details.url) === "playlist") {
      logger.debug("Network:Request", "stream playlist request completed", meta);
    }
  });

  targetSession.webRequest.onErrorOccurred(filter, (details: ErrorDetails) => {
    if (!isStreamRequestUrl(details.url)) return;

    const start = starts.get(details.id);
    starts.delete(details.id);

    if (details.error === "net::ERR_ABORTED") return;

    const kind = requestKind(details.url);
    const meta = {
      ...baseMeta(details, start),
      error: details.error,
      fromCache: details.fromCache,
      status: details.error,
      durationMs: durationMs(details, start),
    };

    if (kind === "segment") {
      logger.warn("Network:Request", "stream segment request failed; hls.js may retry", meta);
      return;
    }

    logger.error("Network:Request", "stream request failed", meta);
  });
}
