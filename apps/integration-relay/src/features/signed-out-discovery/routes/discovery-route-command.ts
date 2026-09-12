import type { ClipTimeRange } from "@streamfusion/core/discovery";

import type {
  DiscoveryPlatform,
  DiscoveryRead
} from "../capabilities/discovery-catalog";

export type DiscoveryRouteKind = DiscoveryRead["kind"];

const ROUTE_KINDS: Readonly<Record<string, DiscoveryRouteKind>> = {
  "/v1/discovery/top-streams": "top-streams",
  "/v1/discovery/categories": "categories",
  "/v1/discovery/search": "search",
  "/v1/discovery/category": "category",
  "/v1/discovery/category-streams": "category-streams",
  "/v1/discovery/category-clips": "category-clips",
  "/v1/discovery/category-videos": "category-videos"
};

export function routeKind(
  pathname: string,
  method: string
): DiscoveryRouteKind | null {
  if (method !== "GET") return null;
  return ROUTE_KINDS[pathname] ?? null;
}

export function platformFrom(url: URL): DiscoveryPlatform | null {
  const platform = url.searchParams.get("platform");
  return platform === "twitch" || platform === "kick" ? platform : null;
}

export function commandFrom(
  kind: DiscoveryRouteKind,
  platform: DiscoveryPlatform,
  url: URL
): DiscoveryRead | null {
  if (kind === "top-streams") return { kind, platform };
  if (kind === "categories") {
    const cursor = optionalCursor(url);
    return cursor === undefined
      ? { kind, platform }
      : { cursor, kind, platform };
  }
  if (kind === "search") {
    const query = url.searchParams.get("q")?.trim() ?? "";
    return query === "" ? null : { kind, platform, query };
  }
  return mediaCommand(kind, platform, url);
}

function mediaCommand(
  kind: Exclude<
    DiscoveryRouteKind,
    "top-streams" | "categories" | "search"
  >,
  platform: DiscoveryPlatform,
  url: URL
): DiscoveryRead | null {
  const categoryId = requiredCategoryId(url);
  if (categoryId === null) return null;
  const cursor = optionalCursor(url);
  if (kind === "category") return { categoryId, kind, platform };
  if (kind === "category-streams") {
    const language = optionalLanguage(url);
    return {
      categoryId,
      kind,
      platform,
      ...(cursor === undefined ? {} : { cursor }),
      ...(language === undefined ? {} : { language })
    };
  }
  if (kind === "category-clips") {
    const timeRange = timeRangeFrom(url);
    return timeRange === null
      ? null
      : {
          categoryId,
          kind,
          platform,
          timeRange,
          ...(cursor === undefined ? {} : { cursor })
        };
  }
  const sort = videoSortFrom(url);
  return sort === null
    ? null
    : {
        categoryId,
        kind,
        platform,
        sort,
        ...(cursor === undefined ? {} : { cursor })
      };
}

function requiredCategoryId(url: URL): string | null {
  const categoryId = url.searchParams.get("categoryId")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,128}$/.test(categoryId) ? categoryId : null;
}

function optionalCursor(url: URL): string | undefined {
  const cursor = url.searchParams.get("cursor")?.trim() ?? "";
  return cursor.length > 0 && cursor.length <= 512 ? cursor : undefined;
}

function optionalLanguage(url: URL): string | undefined {
  const language = url.searchParams.get("language")?.trim().toLowerCase() ?? "";
  return /^[a-z]{2,3}$/.test(language) ? language : undefined;
}

function timeRangeFrom(url: URL): ClipTimeRange | null {
  const timeRange = url.searchParams.get("timeRange") ?? "all";
  return timeRange === "day" ||
    timeRange === "week" ||
    timeRange === "month" ||
    timeRange === "all"
    ? timeRange
    : null;
}

function videoSortFrom(url: URL): "views" | "recent" | null {
  const sort = url.searchParams.get("sort") ?? "recent";
  return sort === "views" || sort === "recent" ? sort : null;
}
