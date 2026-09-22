import type { Platform } from "@streamfusion/core/platform";

import type { AppLinkIntent } from "@mobile/features/shell/capabilities/app-links";
import type { ShellWatchMedia } from "./shell-watch-target";

const allowedProtocols = new Set([
  "streamfusion-development:",
  "streamfusion:",
]);
const identifierPattern = /^[a-zA-Z0-9._:-]{1,256}$/u;
const channelLoginPattern = /^[a-zA-Z0-9_-]{1,64}$/u;
const searchQueryPattern = /^[^\u0000-\u001f]{1,100}$/u;
const watchLiveKeys = new Set(["channelId"]);
const watchMediaKeys = new Set([
  "channelId",
  "duration",
  "mediaId",
  "mediaKind",
  "title",
]);
const searchKeys = new Set(["q"]);

function decodeSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return identifierPattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isPlatform(value: string): value is Platform {
  return value === "twitch" || value === "kick";
}

/** Normalize Expo Router / Expo Go path URLs into host-style app links. */
function normalizeAppLinkUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (!allowedProtocols.has(url.protocol) && url.protocol !== "exp:") {
    return value;
  }
  const path = url.pathname.replace(/^\/+/u, "");
  // Expo Go: exp://host:port/--/search?q=…  or custom scheme path form.
  const expoPath = path.startsWith("--/") ? path.slice(3) : path;
  if (!url.hostname || url.hostname === "127.0.0.1" || url.hostname.includes(".")) {
    const [head, ...rest] = expoPath.split("/").filter(Boolean);
    if (head === "search" || head === "watch" || head === "activity") {
      const scheme = allowedProtocols.has(url.protocol)
        ? url.protocol.replace(/:$/u, "")
        : "streamfusion-development";
      const tail = rest.length > 0 ? `/${rest.join("/")}` : "";
      return `${scheme}://${head}${tail}${url.search}`;
    }
  }
  return value;
}

export function parseAppLink(value: string): AppLinkIntent | null {
  let url: URL;
  try {
    url = new URL(normalizeAppLinkUrl(value));
  } catch {
    return null;
  }
  if (
    !allowedProtocols.has(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.hostname === "activity" &&
    segments.length === 1 &&
    url.search === ""
  ) {
    const eventId = decodeSegment(segments[0] ?? "");
    return eventId ? { kind: "activity-item", eventId } : null;
  }
  const search = parseSearchLink(url, segments);
  if (search !== undefined) return search;
  return parseWatchLink(url, segments);
}

function parseSearchLink(
  url: URL,
  segments: readonly string[],
): AppLinkIntent | null | undefined {
  if (url.hostname !== "search") return undefined;
  if (segments.length !== 0) return null;
  if (![...url.searchParams.keys()].every((key) => searchKeys.has(key))) {
    return null;
  }
  const raw = url.searchParams.get("q");
  if (raw === null) {
    return url.search === "" ? { kind: "search" } : null;
  }
  let query: string;
  try {
    query = raw.trim();
  } catch {
    return null;
  }
  if (query.length === 0) return { kind: "search" };
  if (!searchQueryPattern.test(query)) return null;
  return { kind: "search", query };
}

function parseWatchLink(url: URL, segments: readonly string[]): AppLinkIntent | null {
  if (url.hostname !== "watch" || segments.length !== 2) return null;
  const platform = segments[0] ?? "";
  const channelLogin = decodeSegment(segments[1] ?? "");
  const channelId = url.searchParams.get("channelId");
  const media = parseWatchMedia(url.searchParams);
  if (
    !isPlatform(platform) ||
    !channelLogin ||
    !channelLoginPattern.test(channelLogin) ||
    !channelId ||
    !identifierPattern.test(channelId) ||
    media === null ||
    !allowedWatchKeys(url.searchParams, media)
  ) {
    return null;
  }
  return media === undefined
    ? { kind: "watch-channel", platform, channelId, channelLogin }
    : { kind: "watch-channel", platform, channelId, channelLogin, media };
}

function parseWatchMedia(params: URLSearchParams): ShellWatchMedia | null | undefined {
  const kind = params.get("mediaKind");
  const id = params.get("mediaId");
  const title = params.get("title");
  const duration = params.get("duration");
  const present = [kind, id, title, duration].filter((value) => value !== null);
  if (present.length === 0) return undefined;
  if (present.length !== 4) return null;
  if ((kind !== "clip" && kind !== "video") || !id || !identifierPattern.test(id)) {
    return null;
  }
  if (!title || title.length < 1 || title.length > 256 || /[\u0000-\u001f]/u.test(title)) {
    return null;
  }
  const durationSeconds = Number(duration);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) return null;
  return { durationSeconds, id, kind, title };
}

function allowedWatchKeys(
  params: URLSearchParams,
  media: ShellWatchMedia | undefined,
): boolean {
  const allowed = media === undefined ? watchLiveKeys : watchMediaKeys;
  return [...params.keys()].every((key) => allowed.has(key));
}
