import type { Platform } from "@streamfusion/core/platform";

import type { AppLinkIntent } from "@mobile/capabilities/app-links";

const allowedProtocols = new Set([
  "streamfusion-development:",
  "streamfusion:",
]);
const identifierPattern = /^[a-zA-Z0-9._:-]{1,256}$/u;
const channelLoginPattern = /^[a-zA-Z0-9_-]{1,64}$/u;

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

export function parseAppLink(value: string): AppLinkIntent | null {
  let url: URL;
  try {
    url = new URL(value);
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
  if (url.hostname !== "watch" || segments.length !== 2) return null;
  const platform = segments[0] ?? "";
  const channelLogin = decodeSegment(segments[1] ?? "");
  const channelId = url.searchParams.get("channelId");
  if (
    !isPlatform(platform) ||
    !channelLogin ||
    !channelLoginPattern.test(channelLogin) ||
    !channelId ||
    !identifierPattern.test(channelId) ||
    [...url.searchParams.keys()].some((key) => key !== "channelId")
  ) {
    return null;
  }
  return { kind: "watch-channel", platform, channelId, channelLogin };
}
