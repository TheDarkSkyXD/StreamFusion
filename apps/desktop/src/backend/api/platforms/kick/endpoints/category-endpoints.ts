import { logger } from "@/backend/logging/logger";
import { sleep } from "@/lib/sleep";
import type { UnifiedCategory } from "../../../unified/platform-types";
import type { KickRequestor } from "../kick-requestor";
import { transformKickCategory } from "../kick-transformers";
import type {
  KickApiCategory,
  KickApiResponse,
  PaginatedResult,
  PaginationOptions,
} from "../kick-types";
import { rememberCategorySlug } from "./stream-endpoints";

const KICK_PUBLIC_V2_CATEGORIES_PATH = "/public/v2/categories";
const OFFICIAL_CATEGORY_PAGE_LIMIT = 1000;
const OFFICIAL_CATEGORY_MAX_PAGES = 20;

interface KickApiCursorResponse<T> extends KickApiResponse<T> {
  pagination?: {
    next_cursor?: string | null;
  };
}

const _publicCategoryListCache: {
  data: UnifiedCategory[];
  timestamp: number;
} = { data: [], timestamp: 0 };
const PUBLIC_CATEGORY_LIST_TTL_MS = 15 * 60 * 1000;
const PUBLIC_CATEGORY_LIST_MAX_PAGES = 50;

function officialCategoriesEndpoint(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${KICK_PUBLIC_V2_CATEGORIES_PATH}?${query}` : KICK_PUBLIC_V2_CATEGORIES_PATH;
}

function sortCategories(categories: UnifiedCategory[]): UnifiedCategory[] {
  return categories.sort((a, b) => {
    const viewerDelta = (b.viewerCount || 0) - (a.viewerCount || 0);
    if (viewerDelta !== 0) return viewerDelta;
    return a.name.localeCompare(b.name);
  });
}

function matchesCategoryQuery(category: UnifiedCategory, normalizedQuery: string): boolean {
  const haystacks = [category.name, category.slug, ...(category.tags || [])];

  return haystacks.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

async function searchPublicCategoryList(
  query: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { data: [] };
  }

  try {
    const limit = options.limit ?? 100;
    const matches = sortCategories(
      (await getPublicCategoryList()).filter((category) =>
        matchesCategoryQuery(category, normalizedQuery)
      )
    );

    return { data: matches.slice(0, limit) };
  } catch (error) {
    logger.warn("Kick:Endpoints:Category", "Public Kick category search fallback failed", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return { data: [] };
  }
}

/**
 * Anonymous discovery of Kick categories via the private web category list.
 *
 * This legacy fallback is kept for degraded repair because it works without a
 * token and carries viewer counts. The official `/public/v2/categories` path is
 * the primary source for normal category reads below.
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

    let data: any = null;
    try {
      const res: Response = await net.fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://kick.com/",
          Origin: "https://kick.com",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(5000),
      });
      data = res.ok ? await res.json() : null;
    } catch {
      // Timeout or network error: stop paging and use whatever we have.
    }

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
      if (!numericId || seen.has(numericId)) continue;

      seen.add(numericId);
      const rawTags = Array.isArray(c?.tags) ? c.tags : [];
      const tags = rawTags
        .map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
        .filter((t: string): t is string => t.length > 0);
      const categorySlug = typeof c?.slug === "string" ? c.slug : undefined;

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

async function getPublicTopCategories(): Promise<PaginatedResult<UnifiedCategory>> {
  try {
    const categories = await getPublicCategoryList();
    return { data: categories };
  } catch (error) {
    logger.error("Kick:Endpoints:Category", "Failed to fetch public Kick categories", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return { data: [] };
  }
}

/**
 * Get top/popular categories.
 * https://docs.kick.com/apis/categories - GET /public/v2/categories
 */
export async function getTopCategories(
  client: KickRequestor,
  _options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  try {
    const params = new URLSearchParams();
    params.set("limit", OFFICIAL_CATEGORY_PAGE_LIMIT.toString());

    const response = await client.request<KickApiCursorResponse<KickApiCategory[]>>(
      officialCategoriesEndpoint(params),
      undefined,
      "app"
    );
    const categories = sortCategories((response.data || []).map(transformKickCategory));

    if (categories.length > 0) {
      return { data: categories, cursor: response.pagination?.next_cursor || undefined };
    }
  } catch (error) {
    logger.warn(
      "Kick:Endpoints:Category",
      "Failed to fetch categories via official API; falling back to public legacy category list",
      {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }
    );
  }

  return getPublicTopCategories();
}

/**
 * Search for categories.
 *
 * Uses the anonymous web category list first. The official category search
 * endpoint is app-token authenticated, so a stale Worker app-token path can
 * turn every keystroke in unified search into a 401 log burst. The public list
 * is already used as the degraded source for top/all category reads and carries
 * enough data for search results.
 */
export async function searchCategories(
  _client: KickRequestor,
  query: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  return searchPublicCategoryList(query, options);
}

/**
 * Get category by ID.
 * https://docs.kick.com/apis/categories - GET /public/v2/categories?id[]=:category_id
 */
export async function getCategoryById(
  client: KickRequestor,
  id: string
): Promise<UnifiedCategory | null> {
  try {
    const params = new URLSearchParams();
    params.append("id[]", id);

    const response = await client.request<KickApiCursorResponse<KickApiCategory[]>>(
      officialCategoriesEndpoint(params),
      undefined,
      "app"
    );

    const category = response.data?.[0];
    if (category) {
      return transformKickCategory(category);
    }
    return null;
  } catch (error) {
    logger.warn(
      "Kick:Endpoints:Category",
      "Failed to fetch Kick category via official API; falling back to public",
      {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }
    );
    const publicResult = await getPublicTopCategories();
    return publicResult.data.find((c) => c.id === id) || null;
  }
}

/**
 * Get all Kick categories via the official cursor-paginated category API.
 */
export async function getAllCategories(client: KickRequestor): Promise<UnifiedCategory[]> {
  const categoryMap = new Map<number, UnifiedCategory>();

  try {
    let cursor: string | undefined;

    for (let page = 0; page < OFFICIAL_CATEGORY_MAX_PAGES; page++) {
      const params = new URLSearchParams();
      params.set("limit", OFFICIAL_CATEGORY_PAGE_LIMIT.toString());
      if (cursor) params.set("cursor", cursor);

      const response = await client.request<KickApiCursorResponse<KickApiCategory[]>>(
        officialCategoriesEndpoint(params),
        undefined,
        "app"
      );

      for (const category of response.data || []) {
        if (!categoryMap.has(category.id)) {
          categoryMap.set(category.id, transformKickCategory(category));
        }
      }

      const nextCursor = response.pagination?.next_cursor || undefined;
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
      await sleep(300);
    }
  } catch (error) {
    logger.warn(
      "Kick:Endpoints:Category",
      "Failed to fetch all Kick categories via official API; falling back to public",
      {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }
    );
    const publicResult = await getPublicTopCategories();
    return publicResult.data;
  }

  if (categoryMap.size === 0) {
    logger.warn(
      "Kick:Endpoints:Category",
      "Official API returned no categories; using public fallback"
    );
    const publicResult = await getPublicTopCategories();
    return publicResult.data;
  }

  return sortCategories(Array.from(categoryMap.values()));
}
