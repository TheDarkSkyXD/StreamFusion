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

vi.mock("@backend/api/platforms/kick/endpoints/stream-endpoints", () => ({
  rememberCategorySlug: vi.fn(),
}));

import type { KickRequestor } from "@backend/api/platforms/kick/kick-requestor";

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

// Guards: signed-in and signed-out discovery use the same live Kick catalog with viewer totals.
// Guards: active category-by-ID reads avoid OAuth, while inactive direct links use official v2 only when authenticated.
// Guards: official lookup failures, including cooldowns, resolve safely instead of breaking category navigation.
// Guards: failed or incomplete pagination never replaces the last complete catalog.
// Guards: an unavailable uncached catalog rejects so provider retry remains possible.
// Guards: caller cancellation propagates instead of becoming an empty catalog.
// Guards: bounded category discovery returns its first Kick page without crawling the full catalog.
// Guards: catalog growth beyond 50 pages remains complete instead of discarding every Kick category.
// Guards: an exact category search stops once its live match is found.
describe("category-endpoints", () => {
  let getTopCategories: typeof import("@backend/api/platforms/kick/endpoints/category-endpoints").getTopCategories;
  let searchCategories: typeof import("@backend/api/platforms/kick/endpoints/category-endpoints").searchCategories;
  let getCategoryById: typeof import("@backend/api/platforms/kick/endpoints/category-endpoints").getCategoryById;
  let getAllCategories: typeof import("@backend/api/platforms/kick/endpoints/category-endpoints").getAllCategories;

  beforeEach(async () => {
    mockFetch.mockReset();
    vi.resetModules();
    ({ getTopCategories, searchCategories, getCategoryById, getAllCategories } =
      await import("@backend/api/platforms/kick/endpoints/category-endpoints"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getTopCategories", () => {
    it("returns one live catalog page for a bounded discovery request", async () => {
      const client = createMockClient();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "IRL",
                slug: "irl",
                viewers_count: 4321,
                image_url: "https://files.kick.com/images/subcategories/8549/banner/img.webp",
              },
            ],
            next_cursor: "page-2",
          },
        })
      );

      const result = await getTopCategories(client, { limit: 20 });

      expect(result).toEqual({
        data: [expect.objectContaining({ id: "8549", name: "IRL", viewerCount: 4321 })],
        cursor: "page-2",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("collects a live catalog that has grown beyond 50 pages", async () => {
      const client = createMockClient();
      let page = 0;
      mockFetch.mockImplementation(async () => {
        page += 1;
        return jsonResponse({
          data: {
            categories: [
              {
                name: `Category ${page}`,
                slug: `category-${page}`,
                viewers_count: 1000 - page,
                image_url: `https://files.kick.com/images/subcategories/${page}/banner/img.webp`,
              },
            ],
            next_cursor: page < 51 ? `page-${page + 1}` : null,
          },
        });
      });

      const result = await getTopCategories(client);

      expect(result.data).toHaveLength(51);
      expect(mockFetch).toHaveBeenCalledTimes(51);
    });

    it("uses the same live category catalog while signed in and signed out", async () => {
      const request = vi.fn();
      const authenticatedClient = createMockClient({ request });
      const guestClient = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request,
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

      const authenticated = await getTopCategories(authenticatedClient);
      const guest = await getTopCategories(guestClient);

      expect(authenticated).toEqual(guest);
      expect(authenticated.data[0]).toMatchObject({
        id: "42",
        name: "Public Category",
        slug: "public-cat",
        viewerCount: 1000,
      });
      expect(request).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("rejects an unavailable live catalog so the provider can retry", async () => {
      const request = vi.fn();
      const client = createMockClient({ request });
      mockFetch.mockRejectedValueOnce(new Error("catalog unavailable"));

      await expect(getTopCategories(client)).rejects.toThrow("catalog unavailable");

      expect(request).not.toHaveBeenCalled();
    });

    it("serves the last complete catalog when a refresh fails", async () => {
      const client = createMockClient();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "IRL",
                slug: "irl",
                viewers_count: 4321,
                image_url: "https://files.kick.com/images/subcategories/8549/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const firstResult = await getTopCategories(client);
      const expiredAt = Date.now() + 16 * 60 * 1000;
      vi.spyOn(Date, "now").mockReturnValue(expiredAt);
      mockFetch.mockRejectedValueOnce(new Error("catalog unavailable"));

      await expect(getTopCategories(client)).resolves.toEqual(firstResult);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does not cache a catalog when later pagination fails", async () => {
      const client = createMockClient();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              categories: [
                {
                  name: "Partial",
                  slug: "partial",
                  viewers_count: 100,
                  image_url: "https://files.kick.com/images/subcategories/1/banner/img.webp",
                },
              ],
              next_cursor: "page-2",
            },
          })
        )
        .mockRejectedValueOnce(new Error("second page unavailable"));

      await expect(getTopCategories(client)).rejects.toThrow("second page unavailable");

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Complete",
                slug: "complete",
                viewers_count: 200,
                image_url: "https://files.kick.com/images/subcategories/2/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await getTopCategories(client);

      expect(result.data.map((category) => category.name)).toEqual(["Complete"]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("rejects a repeated pagination cursor instead of caching a partial catalog", async () => {
      const client = createMockClient();
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              categories: [
                {
                  name: "First Page",
                  viewers_count: 200,
                  image_url: "https://files.kick.com/images/subcategories/1/banner/img.webp",
                },
              ],
              next_cursor: "page-2",
            },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              categories: [
                {
                  name: "Second Page",
                  viewers_count: 100,
                  image_url: "https://files.kick.com/images/subcategories/2/banner/img.webp",
                },
              ],
              next_cursor: "page-2",
            },
          })
        );

      await expect(getTopCategories(client)).rejects.toThrow("repeated its pagination cursor");

      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Complete",
                viewers_count: 300,
                image_url: "https://files.kick.com/images/subcategories/3/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const retry = await getTopCategories(client);

      expect(retry.data.map((category) => category.name)).toEqual(["Complete"]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("propagates caller cancellation", async () => {
      const controller = new AbortController();
      controller.abort(new Error("category request cancelled"));

      await expect(
        getTopCategories(createMockClient(), { signal: controller.signal })
      ).rejects.toThrow("category request cancelled");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("searchCategories", () => {
    it("returns an exact live match without crawling later catalog pages", async () => {
      const client = createMockClient();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "IRL",
                slug: "irl",
                viewers_count: 4321,
                image_url: "https://files.kick.com/images/subcategories/8549/banner/img.webp",
              },
            ],
            next_cursor: "page-2",
          },
        })
      );

      const result = await searchCategories(client, "IRL", { limit: 10 });

      expect(result.data).toEqual([
        expect.objectContaining({ id: "8549", name: "IRL", viewerCount: 4321 }),
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

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
    it("returns an active live category without calling the official API", async () => {
      const request = vi.fn();
      const client = createMockClient({ request });
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
      expect(request).not.toHaveBeenCalled();
    });

    it("uses official v2 as an authenticated fallback for a category absent from the live catalog", async () => {
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
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { categories: [], next_cursor: null } })
      );

      const result = await getCategoryById(client, "16");

      expect(result).toMatchObject({ id: "16", name: "Pools, Hot Tubs & Bikinis" });
      expect(request).toHaveBeenCalledWith("https://api.kick.com/public/v2/categories?id=16");
    });

    it("returns null for a missing live category while signed out", async () => {
      const request = vi.fn();
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request,
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { categories: [], next_cursor: null } })
      );

      const result = await getCategoryById(client, "999");

      expect(result).toBeNull();
      expect(request).not.toHaveBeenCalled();
    });

    it.each([
      new Error("official down"),
      Object.assign(new Error("Kick API rate limit active"), { name: "KickRateLimitError" }),
    ])("returns null when the authenticated fallback fails with %s", async (error) => {
      const request = vi.fn().mockRejectedValueOnce(error);
      const client = createMockClient({ request });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { categories: [], next_cursor: null } })
      );

      await expect(getCategoryById(client, "999")).resolves.toBeNull();
      expect(request).toHaveBeenCalledWith("https://api.kick.com/public/v2/categories?id=999");
    });
  });

  describe("getAllCategories", () => {
    it("uses the same live category catalog when signed in and signed out", async () => {
      const request = vi.fn().mockResolvedValueOnce({
        data: [{ id: 8549, name: "IRL", thumbnail: "official.webp" }],
      });
      const authenticatedClient = createMockClient({ request });
      const guestClient = createMockClient({
        isAuthenticated: vi.fn(() => false),
        request,
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "IRL",
                slug: "irl",
                viewers_count: 4321,
                image_url: "https://files.kick.com/images/subcategories/8549/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const authenticated = await getAllCategories(authenticatedClient);
      const guest = await getAllCategories(guestClient);

      expect(authenticated).toEqual(guest);
      expect(authenticated[0]).toMatchObject({ id: "8549", viewerCount: 4321 });
      expect(request).not.toHaveBeenCalled();
    });

    it("returns the live public catalog without calling authenticated transport", async () => {
      const request = vi.fn();
      const client = createMockClient({ request });
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
      expect(request).not.toHaveBeenCalled();
    });
  });
});
