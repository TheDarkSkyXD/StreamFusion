import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module from "module";

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockFetch(...args) } };
  }
  return _origRequire.call(this, id);
};

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/stream-endpoints", () => ({
  rememberCategorySlug: vi.fn(),
}));

import type { KickRequestor } from "@/backend/api/platforms/kick/kick-requestor";

function createMockClient(overrides: Partial<KickRequestor> = {}): KickRequestor {
  return {
    request: vi.fn(),
    isAuthenticated: vi.fn(() => true),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Guards: authenticated Kick categories use the official /public/v2/categories API before private fallback paths.
// Guards: signed-out Kick categories bypass the official requestor and OAuth Worker.
// Guards: bounded discovery requests must forward the requested official limit and cursor instead of exhausting the catalog.
// Guards: category-by-ID lookup must use the documented ID filter and return the requested category even when the response is not ordered.
describe("category-endpoints", () => {
  let getTopCategories: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").getTopCategories;
  let searchCategories: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").searchCategories;
  let getCategoryById: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").getCategoryById;
  let getAllCategories: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").getAllCategories;

  beforeEach(async () => {
    mockFetch.mockReset();
    vi.resetModules();
    ({ getTopCategories, searchCategories, getCategoryById, getAllCategories } =
      await import("@/backend/api/platforms/kick/endpoints/category-endpoints"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getTopCategories", () => {
    it("forwards bounded limit and cursor options to the official API", async () => {
      const request = vi.fn().mockResolvedValueOnce({
        data: [{ id: 20, name: "Fortnite", thumbnail: "https://example.com/fn.webp" }],
        pagination: { next_cursor: "cursor-3" },
      });
      const client = createMockClient({ request });

      const result = await getTopCategories(client, { limit: 12, cursor: "cursor-2" });

      expect(result.data).toHaveLength(1);
      expect(result.cursor).toBe("cursor-3");
      expect(request).toHaveBeenCalledWith(
        "https://api.kick.com/public/v2/categories?limit=12&cursor=cursor-2"
      );
    });

    it("returns categories from official /public/v2/categories", async () => {
      const request = vi.fn().mockResolvedValueOnce({
        data: [
          { id: 20, name: "Fortnite", thumbnail: "https://example.com/fn.webp", tags: ["FPS"] },
          { id: 10, name: "Just Chatting", thumbnail: "https://example.com/jc.webp" },
        ],
        pagination: { next_cursor: "cursor-2" },
      });
      const client = createMockClient({ request });

      const result = await getTopCategories(client);

      expect(result.data.map((c) => c.name)).toEqual(["Fortnite", "Just Chatting"]);
      expect(result.data[0].tags).toEqual(["FPS"]);
      expect(result.cursor).toBe("cursor-2");
      expect(request).toHaveBeenCalledWith("https://api.kick.com/public/v2/categories?limit=1000");
    });

    it("falls back to private category list when official API throws", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("official down")),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Public Category",
                slug: "public-cat",
                viewers_count: 1000,
                image_url: "https://files.kick.com/images/subcategories/42/banner/img.webp",
                tags: ["tag1"],
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await getTopCategories(client);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: "42",
        name: "Public Category",
        viewerCount: 1000,
      });
    });

    it("skips the official API while signed out", async () => {
      const request = vi.fn();
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request,
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { categories: [], next_cursor: null } })
      );

      await getTopCategories(client);

      expect(request).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("searchCategories", () => {
    it("searches via anonymous public category list without app-token auth", async () => {
      const request = vi.fn();
      const client = createMockClient({ request });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Just Chatting",
                slug: "just-chatting",
                viewers_count: 900,
                image_url: "https://files.kick.com/images/subcategories/10/banner/img.webp",
              },
              {
                name: "VALORANT",
                slug: "valorant",
                viewers_count: 1200,
                image_url: "https://files.kick.com/images/subcategories/5/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await searchCategories(client, "chatting");

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Just Chatting");
      expect(request).not.toHaveBeenCalled();
    });

    it("matches public categories by slug and tags", async () => {
      const request = vi.fn();
      const client = createMockClient({ request });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "VALORANT",
                slug: "valorant",
                viewers_count: 1200,
                image_url: "https://files.kick.com/images/subcategories/5/banner/img.webp",
                tags: ["FPS"],
              },
              {
                name: "Just Chatting",
                slug: "just-chatting",
                viewers_count: 900,
                image_url: "https://files.kick.com/images/subcategories/10/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await searchCategories(client, "Valor");

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: "5",
        name: "VALORANT",
        slug: "valorant",
      });
      expect(request).not.toHaveBeenCalled();
    });

    it("returns empty data when the public list has no match", async () => {
      const client = createMockClient({
        request: vi.fn(),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "VALORANT",
                slug: "valorant",
                viewers_count: 1200,
                image_url: "https://files.kick.com/images/subcategories/5/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await searchCategories(client, "anything");

      expect(result.data).toEqual([]);
    });
  });

  describe("getCategoryById", () => {
    it("uses the official v2 id parameter", async () => {
      const request = vi.fn().mockResolvedValueOnce({
        data: [
          {
            id: 16,
            name: "Pools, Hot Tubs & Bikinis",
            thumbnail: "https://example.com/pools.webp",
          },
        ],
      });
      const client = createMockClient({ request });

      const result = await getCategoryById(client, "16");

      expect(result).toMatchObject({ id: "16", name: "Pools, Hot Tubs & Bikinis" });
      expect(request).toHaveBeenCalledWith("https://api.kick.com/public/v2/categories?id=16");
    });

    it("selects the requested category when the response is not ordered", async () => {
      const request = vi.fn().mockResolvedValueOnce({
        data: [
          { id: 1, name: "Apex Legends", thumbnail: "https://example.com/apex.webp" },
          {
            id: 16,
            name: "Pools, Hot Tubs & Bikinis",
            thumbnail: "https://example.com/pools.webp",
          },
        ],
      });
      const client = createMockClient({ request });

      const result = await getCategoryById(client, "16");

      expect(result).toMatchObject({ id: "16", name: "Pools, Hot Tubs & Bikinis" });
    });

    it("merges the public slug and authoritative viewer count into an official category", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [{ id: 16, name: "Pools, Hot Tubs & Bikinis", thumbnail: "official.webp" }],
        }),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Pools, Hot Tubs & Bikinis",
                slug: "pools-hot-tubs-and-bikinis",
                viewers_count: 321,
                image_url: "https://files.kick.com/images/subcategories/16/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await getCategoryById(client, "16");

      expect(result).toMatchObject({
        id: "16",
        slug: "pools-hot-tubs-and-bikinis",
        viewerCount: 321,
      });
    });

    it("returns null when official v2 returns no category", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: [] }),
      });

      const result = await getCategoryById(client, "999");

      expect(result).toBeNull();
    });

    it("falls back to private category list on official failure", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("fail")),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Found via public",
                slug: "found",
                viewers_count: 50,
                image_url: "https://files.kick.com/images/subcategories/42/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await getCategoryById(client, "42");

      expect(result).toMatchObject({ id: "42", name: "Found via public" });
    });
  });

  describe("getAllCategories", () => {
    it("paginates official v2 categories by cursor", async () => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ id: 1, name: "Cat1", thumbnail: "" }],
          pagination: { next_cursor: "cursor-2" },
        })
        .mockResolvedValueOnce({
          data: [{ id: 2, name: "Cat2", thumbnail: "" }],
          pagination: { next_cursor: null },
        });
      const client = createMockClient({ request });

      const result = await getAllCategories(client);

      expect(result.map((c) => c.name)).toEqual(["Cat1", "Cat2"]);
      expect(request).toHaveBeenNthCalledWith(
        1,
        "https://api.kick.com/public/v2/categories?limit=1000"
      );
      expect(request).toHaveBeenNthCalledWith(
        2,
        "https://api.kick.com/public/v2/categories?limit=1000&cursor=cursor-2"
      );
    });

    it("falls back to private category list when official returns empty categories", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: [] }),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Fallback Cat",
                viewers_count: 50,
                slug: "fb",
                image_url: "https://files.kick.com/images/subcategories/99/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await getAllCategories(client);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Fallback Cat");
    });
  });
});
