import type {
  FollowedClipPeriod,
  FollowedContentRead,
  FollowedPlatform,
  FollowedRecordedSort
} from "../capabilities/followed-content-catalog";
import { parseFollowedIdentityRefs } from "@streamfusion/core/relay";

const SORTS = new Set<FollowedRecordedSort>(["recent", "views"]);
const PERIODS = new Set<FollowedClipPeriod>(["day", "week", "month", "all"]);

export function followedContentCommand(
  pathname: string,
  method: string,
  url: URL
): FollowedContentRead | null {
  if (method !== "GET") return null;
  const kind = routeKind(pathname);
  if (kind === null) return null;
  const platform = platformFrom(url);
  if (platform === null) return null;
  if (kind === "streams" || kind === "channels") {
    const refs = parseFollowedIdentityRefs({
      ids: url.searchParams.getAll("id"),
      logins: url.searchParams.getAll("login")
    });
    return refs === null ? null : { kind, platform, refs };
  }
  const channelId = url.searchParams.get("channelId")?.trim() ?? "";
  if (channelId.length === 0 || channelId.length > 128) return null;
  const sort = sortFrom(url);
  const period = periodFrom(url);
  if (sort === null || period === null) return null;
  return kind === "videos"
    ? { kind, platform, channelId, sort }
    : { kind, platform, channelId, period, sort };
}

export function followedContentKind(
  pathname: string,
  method: string
): FollowedContentRead["kind"] | null {
  return method === "GET" ? routeKind(pathname) : null;
}

function routeKind(pathname: string): FollowedContentRead["kind"] | null {
  if (pathname === "/v1/followed-content/streams") return "streams";
  if (pathname === "/v1/followed-content/channels") return "channels";
  if (pathname === "/v1/followed-content/videos") return "videos";
  if (pathname === "/v1/followed-content/clips") return "clips";
  return null;
}

function platformFrom(url: URL): FollowedPlatform | null {
  const platform = url.searchParams.get("platform");
  return platform === "twitch" || platform === "kick" ? platform : null;
}

function sortFrom(url: URL): FollowedRecordedSort | null {
  const value = url.searchParams.get("sort") ?? "recent";
  return SORTS.has(value as FollowedRecordedSort)
    ? (value as FollowedRecordedSort)
    : null;
}

function periodFrom(url: URL): FollowedClipPeriod | null {
  const value = url.searchParams.get("period") ?? "all";
  return PERIODS.has(value as FollowedClipPeriod)
    ? (value as FollowedClipPeriod)
    : null;
}
