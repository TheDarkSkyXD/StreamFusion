import type { UnifiedCategory } from "../../../unified/platform-types";
import type { KickRequestor } from "../kick-requestor";
import { transformKickCategory } from "../kick-transformers";
import type {
  KickApiCategory,
  KickApiLivestream,
  KickApiResponse,
  PaginatedResult,
  PaginationOptions,
} from "../kick-types";

import { rememberCategorySlug } from "./stream-endpoints";

const _publicCategoryListCache: {
  data: UnifiedCategory[];
  timestamp: number;
} = { data: [], timestamp: 0 };
const PUBLIC_CATEGORY_LIST_TTL_MS = 15 * 60 * 1000;
// 50 pages × 20 = 1000 categories ceiling. Pagination short-circuits on the
// first viewers_count=0 result anyway, so this is just a runaway guard.
const PUBLIC_CATEGORY_LIST_MAX_PAGES = 50;

/**
 * Anonymous discovery of Kick categories via /private/v1/categories.
 *
 * This is the only browse-all endpoint that works without auth — the official
 * /public/v1/categories endpoint requires an app token, and aggregating from
 * /stream/livestreams dumps only surfaces categories whose top streams happen
 * to be in our handful of language dumps (~27 categories vs the ~740 that
 * actually have viewers right now).
 *
 * Response carries ULID ids that don't match the rest of the app, but
 * `image_url` paths embed the numeric id (e.g. `/subcategories/15/banner/…`).
 * We parse it out so callers can address categories by the same numeric id
 * surfaced by /livestreams.
 *
 * Paginated by `next_cursor`, sorted server-side by viewer count descending.
 * We stop on the first page that contains a viewers_count=0 entry — every
 * subsequent category is dead, and the existing Categories page intentionally
 * hides those. Cached for 15 minutes since banners and the active-set churn
 * slowly.
 */
async function getPublicCategoryList(): Promise<UnifiedCategory[]> {
  const now = Date.now();
  if (
    _publicCategoryListCache.data.length > 0 &&
    now - _publicCategoryListCache.timestamp < PUBLIC_CATEGORY_LIST_TTL_MS
  ) {
    return _publicCategoryListCache.data;
  }

  const { net } = require("electron");
  const list: UnifiedCategory[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let reachedInactive = false;

  for (let page = 0; page < PUBLIC_CATEGORY_LIST_MAX_PAGES; page++) {
    const url = `https://api.kick.com/private/v1/categories${
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    }`;

    const data = await new Promise<any>((resolve) => {
      const request = net.request({ method: "GET", url });
      request.setHeader("Accept", "application/json");
      request.setHeader(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      request.setHeader("Referer", "https://kick.com/");
      request.setHeader("Origin", "https://kick.com");
      request.setHeader("X-Requested-With", "XMLHttpRequest");

      const timeout = setTimeout(() => {
        request.abort();
        resolve(null);
      }, 5000);

      request.on("response", (response: any) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          clearTimeout(timeout);
          if (response.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      });

      request.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });

      request.end();
    });

    if (!data) break;
    const categories = data?.data?.categories || [];

    for (const c of categories) {
      const viewers = Number(c?.viewers_count) || 0;
      if (viewers <= 0) {
        reachedInactive = true;
        continue;
      }
      const imageUrl = typeof c?.image_url === "string" ? c.image_url : "";
      const idMatch = imageUrl.match(/\/subcategories\/(\d+)\//);
      const numericId = idMatch?.[1];
      // No numeric id means no /subcategories/{id}/banner/… in the URL — we
      // can't address this category from the rest of the app, so skip it.
      if (!numericId || seen.has(numericId)) continue;
      seen.add(numericId);
      const rawTags = Array.isArray(c?.tags) ? c.tags : [];
      const tags = rawTags
        .map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
        .filter((t: string): t is string => t.length > 0);
      const categorySlug = typeof c?.slug === "string" ? c.slug : undefined;
      // Seed the id → slug map in stream-endpoints so that clicking a
      // Kick-only category resolves to /private/v1/categories/{slug}/livestreams
      // instead of falling back to filtering the global top-streams dump (which
      // returns zero for any category that isn't currently in the dump).
      rememberCategorySlug(numericId, categorySlug);
      list.push({
        id: numericId,
        platform: "kick",
        name: typeof c?.name === "string" ? c.name : "",
        boxArtUrl: imageUrl,
        slug: categorySlug,
        tags: tags.length > 0 ? tags : undefined,
        viewerCount: viewers,
      });
    }

    if (reachedInactive) break;

    const next = data?.data?.next_cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }

  if (list.length > 0) {
    _publicCategoryListCache.data = list;
    _publicCategoryListCache.timestamp = now;
  }
  return list;
}

/**
 * Get categories from public/legacy API (No Auth Required).
 *
 * Sources from /private/v1/categories, the only anonymous browse-all endpoint
 * Kick exposes. Returns every category with at least one active viewer, sorted
 * by viewer count descending. See `getPublicCategoryList` for the pagination /
 * caching details.
 */
export async function getPublicTopCategories(): Promise<PaginatedResult<UnifiedCategory>> {
  try {
    const categories = await getPublicCategoryList();
    return { data: categories };
  } catch (error) {
    console.error("Failed to fetch public Kick categories:", error);
    return { data: [] };
  }
}

/**
 * Get top/popular categories (derived from top streams)
 * Note: Kick official API doesn't have a "browse all" endpoint, so we aggregate from streams
 * Uses App Token if available, falls back to public API if not authenticated
 */
export async function getTopCategories(
  client: KickRequestor,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  try {
    // Try official API first (will use App Token if available via KickClient.request fallback)
    const params = new URLSearchParams();
    params.set("limit", "100");
    params.set("sort", "viewer_count");

    const response = await client.request<KickApiResponse<KickApiLivestream[]>>(
      `/livestreams?${params.toString()}`
    );
    const rawStreams = response.data || [];

    const distinctCategories = new Map<number, UnifiedCategory>();

    for (const s of rawStreams) {
      if (s.category && !distinctCategories.has(s.category.id)) {
        distinctCategories.set(s.category.id, {
          id: s.category.id.toString(),
          platform: "kick",
          name: s.category.name,
          boxArtUrl: s.category.thumbnail || "",
          viewerCount: 0,
        });
      }

      // Aggregate viewer counts from these top streams
      if (s.category && distinctCategories.has(s.category.id)) {
        const cat = distinctCategories.get(s.category.id)!;
        cat.viewerCount = (cat.viewerCount || 0) + s.viewer_count;
      }
    }

    const categories = Array.from(distinctCategories.values()).sort(
      (a, b) => (b.viewerCount || 0) - (a.viewerCount || 0)
    );

    return { data: categories };
  } catch (error) {
    console.warn(
      "Failed to fetch Kick top categories via official API, falling back to public:",
      error
    );
    // Fallback to public API (no auth required)
    return getPublicTopCategories();
  }
}

/**
 * Search for categories
 * https://docs.kick.com/apis/categories - GET /public/v1/categories?q=:query
 */
export async function searchCategories(
  client: KickRequestor,
  query: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  // The /categories search endpoint requires app-token auth. When unauthenticated,
  // fall back to extracting categories from the public top-streams feed so that
  // cross-platform category matching (e.g. Twitch→Kick on a category detail page)
  // still works for any category that currently has at least one live Kick stream.
  if (!client.isAuthenticated()) {
    const publicResult = await getPublicTopCategories();
    const normalized = query.toLowerCase().trim();
    const matches = publicResult.data.filter((c) => c.name.toLowerCase().includes(normalized));
    return { data: matches };
  }

  try {
    const params = new URLSearchParams({
      q: query,
    });
    if (options.page) {
      params.set("page", options.page.toString());
    }

    const response = await client.request<KickApiResponse<KickApiCategory[]>>(
      `/categories?${params.toString()}`
    );

    const categories = (response.data || []).map(transformKickCategory);

    return {
      data: categories,
      nextPage: categories.length >= 100 ? (options.page || 1) + 1 : undefined,
    };
  } catch (error) {
    console.error("Failed to search Kick categories:", error);
    return { data: [] };
  }
}

/**
 * Get category by ID
 * https://docs.kick.com/apis/categories - GET /public/v1/categories/:category_id
 *
 * Falls back to public top-streams aggregation when unauthenticated or when the
 * official endpoint fails, mirroring the pattern in searchCategories/getAllCategories.
 * Limitation: a category with no currently-live streams won't be findable via the
 * public path — acceptable because the rest of the unauthenticated flow has the
 * same constraint.
 */
export async function getCategoryById(
  client: KickRequestor,
  id: string
): Promise<UnifiedCategory | null> {
  if (!client.isAuthenticated()) {
    const publicResult = await getPublicTopCategories();
    return publicResult.data.find((c) => c.id === id) || null;
  }

  try {
    const response = await client.request<KickApiResponse<KickApiCategory>>(`/categories/${id}`);

    if (response.data) {
      return transformKickCategory(response.data);
    }
    return null;
  } catch (error) {
    console.warn(
      "Failed to fetch Kick category via official API, falling back to public:",
      error
    );
    const publicResult = await getPublicTopCategories();
    return publicResult.data.find((c) => c.id === id) || null;
  }
}

/**
 * Helper to add delay between requests to respect rate limits
 */
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get ALL categories from Kick that have live streams.
 * Extracts categories from multiple pages of top streams (sequential with rate limiting).
 * This is a workaround since Kick lacks a "browse all" endpoint.
 * Falls back to public API if official API fails.
 *
 * NOTE: Only returns categories with active live streams. Categories with no streams
 * are intentionally excluded from the Categories page display.
 *
 * RATE LIMIT AWARE: Uses sequential requests with delays to prevent 429 errors
 */
export async function getAllCategories(client: KickRequestor): Promise<UnifiedCategory[]> {
  // The official /livestreams endpoint requires app-token auth. If the user isn't
  // authenticated, skip the three guaranteed-to-fail requests and go straight to public.
  if (!client.isAuthenticated()) {
    const publicResult = await getPublicTopCategories();
    return publicResult.data;
  }

  const categoryMap = new Map<number, UnifiedCategory>();

  try {
    // Fetch pages of streams sequentially to avoid 429 rate limits.
    // 10 pages × 100 streams = up to 1000 streams scanned for distinct
    // categories. The previous 3-page cap was the main reason niche Kick-only
    // categories never showed up — they exist on Kick but don't crack the
    // global top 300 livestreams, so they were invisible to the Categories
    // page. The rate-limited 300ms gap between requests keeps total wall time
    // around 3s.
    const offsets = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];

    for (const offset of offsets) {
      try {
        const response = await client.request<KickApiResponse<KickApiLivestream[]>>(
          `/livestreams?limit=100&offset=${offset}&sort=viewer_count`
        );

        const streams = response.data || [];
        // End of list reached — Kick stops returning new streams past the
        // total live count, so further offsets would be wasted requests.
        if (streams.length === 0) break;

        for (const s of streams) {
          if (s.category && !categoryMap.has(s.category.id)) {
            categoryMap.set(s.category.id, {
              id: s.category.id.toString(),
              platform: "kick",
              name: s.category.name,
              boxArtUrl: s.category.thumbnail || "",
              viewerCount: 0,
            });
          }
          // Aggregate viewer counts
          if (s.category && categoryMap.has(s.category.id)) {
            const cat = categoryMap.get(s.category.id)!;
            cat.viewerCount = (cat.viewerCount || 0) + s.viewer_count;
          }
        }

        // Add delay between requests to respect rate limits
        if (offset < offsets[offsets.length - 1]) {
          await delay(300);
        }
      } catch (err) {
        console.warn(`Failed to fetch Kick streams at offset ${offset}:`, err);
        // Continue with next offset
      }
    }
  } catch (error) {
    console.warn(
      "Failed to fetch all Kick categories via official API, falling back to public:",
      error
    );
    // Fallback to public API
    const publicResult = await getPublicTopCategories();
    return publicResult.data;
  }

  // If official API returned nothing, try fallback
  if (categoryMap.size === 0) {
    console.warn("Official API returned no categories, using public fallback");
    const publicResult = await getPublicTopCategories();
    return publicResult.data;
  }

  return Array.from(categoryMap.values()).sort(
    (a, b) => (b.viewerCount || 0) - (a.viewerCount || 0)
  );
}
