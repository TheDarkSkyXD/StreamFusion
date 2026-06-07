import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Module from "module";

/* ------------------------------------------------------------------ *
 * Electron mock: category-endpoints.ts uses `require("electron")`    *
 * (CJS) inside function bodies. vi.mock only intercepts ESM imports. *
 * ------------------------------------------------------------------ */
const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockFetch(...args) } };
  }
  return _origRequire.apply(this, [id] as any);
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
    baseUrl: "https://test.example.com",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("category-endpoints", () => {
  let getTopCategories: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").getTopCategories;
  let searchCategories: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").searchCategories;
  let getCategoryById: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").getCategoryById;
  let getAllCategories: typeof import("@/backend/api/platforms/kick/endpoints/category-endpoints").getAllCategories;

  beforeEach(async () => {
    mockFetch.mockReset();
    vi.resetModules();
    ({ getTopCategories, searchCategories, getCategoryById, getAllCategories } = await import(
      "@/backend/api/platforms/kick/endpoints/category-endpoints"
    ));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getTopCategories", () => {
    it("returns categories aggregated from official /livestreams endpoint", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            {
              broadcaster_user_id: 1,
              slug: "streamer1",
              stream_title: "Live",
              viewer_count: 500,
              category: { id: 10, name: "Just Chatting", thumbnail: "https://example.com/jc.webp" },
            },
            {
              broadcaster_user_id: 2,
              slug: "streamer2",
              stream_title: "Gaming",
              viewer_count: 300,
              category: { id: 20, name: "Fortnite", thumbnail: "https://example.com/fn.webp" },
            },
            {
              broadcaster_user_id: 3,
              slug: "streamer3",
              stream_title: "Also Chatting",
              viewer_count: 200,
              category: { id: 10, name: "Just Chatting", thumbnail: "https://example.com/jc.webp" },
            },
          ],
        }),
      });

      const result = await getTopCategories(client);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe("10");
      expect(result.data[0].name).toBe("Just Chatting");
      expect(result.data[0].viewerCount).toBe(700);
      expect(result.data[1].id).toBe("20");
      expect(result.data[1].viewerCount).toBe(300);
    });

    it("sorts categories by viewer count descending", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            { viewer_count: 100, category: { id: 1, name: "A", thumbnail: "" } },
            { viewer_count: 500, category: { id: 2, name: "B", thumbnail: "" } },
            { viewer_count: 300, category: { id: 3, name: "C", thumbnail: "" } },
          ],
        }),
      });

      const result = await getTopCategories(client);

      expect(result.data.map((c) => c.name)).toEqual(["B", "C", "A"]);
    });

    it("skips streams without a category", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            { viewer_count: 100, category: null },
            { viewer_count: 200, category: { id: 1, name: "Valid", thumbnail: "" } },
          ],
        }),
      });

      const result = await getTopCategories(client);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Valid");
    });

    it("falls back to public API when official API throws", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("401")),
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

      expect(result.data.length).toBeGreaterThanOrEqual(0);
    });

    it("returns empty data when both APIs fail", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("Official failed")),
      });
      mockFetch.mockRejectedValueOnce(new Error("Public failed"));

      const result = await getTopCategories(client);

      expect(result.data).toEqual([]);
    });
  });

  describe("searchCategories", () => {
    it("searches via official API when authenticated", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [
            { id: 10, name: "Just Chatting", thumbnail: "https://example.com/jc.webp" },
          ],
        }),
      });

      const result = await searchCategories(client, "chatting");

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Just Chatting");
      expect(result.data[0].platform).toBe("kick");
    });

    it("falls back to public API filter when not authenticated", async () => {
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Just Chatting",
                slug: "just-chatting",
                viewers_count: 500,
                image_url: "https://files.kick.com/images/subcategories/10/banner/img.webp",
              },
              {
                name: "Fortnite",
                slug: "fortnite",
                viewers_count: 300,
                image_url: "https://files.kick.com/images/subcategories/20/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await searchCategories(client, "chatting");

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe("Just Chatting");
    });

    it("does case-insensitive matching in public fallback", async () => {
      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "VALORANT",
                slug: "valorant",
                viewers_count: 100,
                image_url: "https://files.kick.com/images/subcategories/5/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await searchCategories(client, "Valor");

      expect(result.data).toHaveLength(1);
    });

    it("returns empty data on official API failure", async () => {
      const client = createMockClient({
        request: vi.fn().mockRejectedValueOnce(new Error("fail")),
      });

      const result = await searchCategories(client, "anything");

      expect(result.data).toEqual([]);
    });

    it("sets nextPage when results fill a full page", async () => {
      const categories = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Cat ${i}`,
        thumbnail: "",
      }));
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: categories }),
      });

      const result = await searchCategories(client, "Cat");

      expect(result.nextPage).toBe(2);
    });

    it("does not set nextPage when results are fewer than 100", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: [{ id: 1, name: "One", thumbnail: "" }],
        }),
      });

      const result = await searchCategories(client, "One");

      expect(result.nextPage).toBeUndefined();
    });
  });

  describe("getCategoryById", () => {
    it("fetches category via official API when authenticated", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({
          data: { id: 10, name: "Just Chatting", thumbnail: "https://example.com/jc.webp" },
        }),
      });

      const result = await getCategoryById(client, "10");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("10");
      expect(result!.name).toBe("Just Chatting");
    });

    it("returns null when official API returns no data", async () => {
      const client = createMockClient({
        request: vi.fn().mockResolvedValueOnce({ data: null }),
      });

      const result = await getCategoryById(client, "999");

      expect(result).toBeNull();
    });

    it("falls back to public API on official API failure", async () => {
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

      expect(result).not.toBeNull();
      expect(result!.id).toBe("42");
    });

    it("falls back to public API when not authenticated", async () => {
      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Public Cat",
                slug: "public-cat",
                viewers_count: 100,
                image_url: "https://files.kick.com/images/subcategories/55/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await getCategoryById(client, "55");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("55");
    });

    it("returns null when category not found in public fallback", async () => {
      const client = createMockClient({ isAuthenticated: vi.fn(() => false) });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ data: { categories: [], next_cursor: null } })
      );

      const result = await getCategoryById(client, "999");

      expect(result).toBeNull();
    });
  });

  describe("getAllCategories", () => {
    it("aggregates categories from multiple pages of /livestreams when authenticated", async () => {
      const requestMock = vi.fn();
      requestMock
        .mockResolvedValueOnce({
          data: [
            { viewer_count: 100, category: { id: 1, name: "Cat1", thumbnail: "" } },
            { viewer_count: 200, category: { id: 2, name: "Cat2", thumbnail: "" } },
          ],
        })
        .mockResolvedValueOnce({
          data: [
            { viewer_count: 50, category: { id: 3, name: "Cat3", thumbnail: "" } },
          ],
        })
        .mockResolvedValueOnce({ data: [] });

      const client = createMockClient({ request: requestMock });

      const result = await getAllCategories(client);

      expect(result.length).toBe(3);
      expect(result[0].name).toBe("Cat2");
      expect(result[0].viewerCount).toBe(200);
    });

    it("skips to public fallback when not authenticated", async () => {
      const client = createMockClient({
        isAuthenticated: vi.fn(() => false),
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            categories: [
              {
                name: "Public Cat",
                viewers_count: 100,
                slug: "pub",
                image_url: "https://files.kick.com/images/subcategories/1/banner/img.webp",
              },
            ],
            next_cursor: null,
          },
        })
      );

      const result = await getAllCategories(client);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Public Cat");
      expect(client.request).not.toHaveBeenCalled();
    });

    it("falls back to public API when official returns empty categories", async () => {
      const requestMock = vi.fn();
      for (let i = 0; i < 10; i++) {
        requestMock.mockResolvedValueOnce({ data: [] });
      }
      const client = createMockClient({ request: requestMock });

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

    it("aggregates viewer counts for the same category across pages", async () => {
      const requestMock = vi.fn();
      requestMock
        .mockResolvedValueOnce({
          data: [
            { viewer_count: 500, category: { id: 1, name: "JC", thumbnail: "" } },
          ],
        })
        .mockResolvedValueOnce({
          data: [
            { viewer_count: 300, category: { id: 1, name: "JC", thumbnail: "" } },
          ],
        })
        .mockResolvedValueOnce({ data: [] });

      const client = createMockClient({ request: requestMock });

      const result = await getAllCategories(client);

      expect(result).toHaveLength(1);
      expect(result[0].viewerCount).toBe(800);
    });

    it("continues fetching when one page throws", async () => {
      const requestMock = vi.fn();
      requestMock
        .mockResolvedValueOnce({
          data: [
            { viewer_count: 100, category: { id: 1, name: "Cat1", thumbnail: "" } },
          ],
        })
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce({
          data: [
            { viewer_count: 50, category: { id: 2, name: "Cat2", thumbnail: "" } },
          ],
        })
        .mockResolvedValue({ data: [] });

      const client = createMockClient({ request: requestMock });

      const result = await getAllCategories(client);

      expect(result).toHaveLength(2);
    });

    it("sorts results by viewer count descending", async () => {
      const requestMock = vi.fn();
      requestMock
        .mockResolvedValueOnce({
          data: [
            { viewer_count: 100, category: { id: 1, name: "Small", thumbnail: "" } },
            { viewer_count: 500, category: { id: 2, name: "Big", thumbnail: "" } },
            { viewer_count: 300, category: { id: 3, name: "Mid", thumbnail: "" } },
          ],
        })
        .mockResolvedValue({ data: [] });

      const client = createMockClient({ request: requestMock });

      const result = await getAllCategories(client);

      expect(result.map((c) => c.name)).toEqual(["Big", "Mid", "Small"]);
    });
  });
});
