import { logger } from "@backend/logging/logger";
import type { UnifiedCategory } from "../../../../../shared/platform-types";
import type { KickRequestor } from "../kick-requestor";
import { transformKickCategory } from "../kick-transformers";
import type {
  KickApiCategory,
  KickApiResponse,
  PaginatedResult,
  PaginationOptions,
} from "../kick-types";
import { rememberCategorySlug } from "./stream-endpoints";

const KICK_PUBLIC_V2_CATEGORIES_URL = "https://api.kick.com/public/v2/categories";

const _publicCategoryListCache: {
  data: UnifiedCategory[];
  timestamp: number;
} = { data: [], timestamp: 0 };
const PUBLIC_CATEGORY_LIST_TTL_MS = 15 * 60 * 1000;
const PUBLIC_CATEGORY_LIST_MAX_PAGES = 50;

function officialCategoriesEndpoint(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${KICK_PUBLIC_V2_CATEGORIES_URL}?${query}` : KICK_PUBLIC_V2_CATEGORIES_URL;
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
      (await getPublicCategoryList(options.signal)).filter((category) =>
        matchesCategoryQuery(category, normalizedQuery)
      )
    );

    return { data: matches.slice(0, limit) };
  } catch (error) {
    options.signal?.throwIfAborted();
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
 * Anonymous discovery of active Kick categories via an internal web category list.
 *
 * The official `/public/v2/categories` response does not expose live viewer
 * totals, so this internal endpoint is required for the live discovery catalog.
 */
async function getPublicCategoryList(signal?: AbortSignal): Promise<UnifiedCategory[]> {
  signal?.throwIfAborted();
  const now = Date.now();
  if (
    _publicCategoryListCache.data.length > 0 &&
    now - _publicCategoryListCache.timestamp < PUBLIC_CATEGORY_LIST_TTL_MS
  ) {
    return _publicCategoryListCache.data;
  }

  const { net } = require("electron");
  const staleCategories = _publicCategoryListCache.data;
  const list: UnifiedCategory[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let reachedInactive = false;
  let reachedEnd = false;

  for (let page = 0; page < PUBLIC_CATEGORY_LIST_MAX_PAGES; page++) {
    signal?.throwIfAborted();
    const url = `https://api.kick.com/private/v1/categories${
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    }`;

    let data: unknown;
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
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error(`Kick category catalog request failed with HTTP ${res.status}`);
      }
      data = await res.json();
    } catch (error) {
      signal?.throwIfAborted();
      if (staleCategories.length > 0) return staleCategories;
      throw error;
    }

    if (!isPrivateCategoryPage(data)) {
      if (staleCategories.length > 0) return staleCategories;
      throw new Error("Kick category catalog returned an invalid response");
    }
    const categories = data.data.categories;

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

    if (reachedInactive) {
      reachedEnd = true;
      break;
    }

    const next = data.data.next_cursor;
    if (!next) {
      reachedEnd = true;
      break;
    }
    if (next === cursor) {
      if (staleCategories.length > 0) return staleCategories;
      throw new Error("Kick category catalog repeated its pagination cursor");
    }
    cursor = next;
  }

  if (!reachedEnd || list.length === 0) {
    if (staleCategories.length > 0) return staleCategories;
    throw new Error(
      reachedEnd
        ? "Kick category catalog returned no active categories"
        : "Kick category catalog exceeded its pagination limit"
    );
  }

  _publicCategoryListCache.data = list;
  _publicCategoryListCache.timestamp = now;
  return list;
}

interface PrivateCategoryRecord {
  viewers_count?: unknown;
  image_url?: unknown;
  tags?: unknown;
  slug?: unknown;
  name?: unknown;
}

function isPrivateCategoryPage(
  value: unknown
): value is { data: { categories: PrivateCategoryRecord[]; next_cursor?: string } } {
  if (typeof value !== "object" || value === null || !("data" in value)) return false;
  const data = value.data;
  return (
    typeof data === "object" &&
    data !== null &&
    "categories" in data &&
    Array.isArray(data.categories)
  );
}

async function getPublicTopCategories(
  signal?: AbortSignal
): Promise<PaginatedResult<UnifiedCategory>> {
  const categories = await getPublicCategoryList(signal);
  return { data: categories };
}

/**
 * Get the active live category catalog with current viewer totals.
 */
export async function getTopCategories(
  _client: KickRequestor,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  return getPublicTopCategories(options.signal);
}

/**
 * Search for categories.
 *
 * Uses the anonymous web category list. Search must remain available without
 * sending discovery traffic through the OAuth Worker.
 */
export async function searchCategories(
  _client: KickRequestor,
  query: string,
  options: PaginationOptions = {}
): Promise<PaginatedResult<UnifiedCategory>> {
  return searchPublicCategoryList(query, options);
}

/**
 * Get an active category from the live catalog, with official v2 as an
 * authenticated fallback for inactive direct links.
 */
export async function getCategoryById(
  client: KickRequestor,
  id: string
): Promise<UnifiedCategory | null> {
  try {
    const publicResult = await getPublicTopCategories();
    const publicCategory = publicResult.data.find((category) => category.id === id);
    if (publicCategory) return publicCategory;
  } catch (error) {
    logger.warn("Kick:Endpoints:Category", "Failed to read the live Kick category catalog", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
  }

  if (!client.isAuthenticated()) return null;

  try {
    const params = new URLSearchParams();
    params.set("id", id);

    const response = await client.request<KickApiResponse<KickApiCategory[]>>(
      officialCategoriesEndpoint(params)
    );

    const category = response.data?.find((candidate) => String(candidate.id) === id);
    return category ? transformKickCategory(category) : null;
  } catch (error) {
    logger.warn(
      "Kick:Endpoints:Category",
      "Failed to fetch inactive Kick category via official API",
      {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }
    );
    return null;
  }
}

/**
 * Get all active live Kick categories with the same catalog used for guests.
 */
export async function getAllCategories(_client: KickRequestor): Promise<UnifiedCategory[]> {
  const publicResult = await getPublicTopCategories();
  return publicResult.data;
}
