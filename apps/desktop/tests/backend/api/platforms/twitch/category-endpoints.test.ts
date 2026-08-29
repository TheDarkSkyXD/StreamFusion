import { describe, expect, it, vi } from "vitest";

vi.mock("@backend/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  getAllTopCategories,
  getCategoriesByIds,
  getCategoryById,
  getTopCategories,
} from "@backend/api/platforms/twitch/endpoints/category-endpoints";

import type { TwitchRequestor } from "@backend/api/platforms/twitch/twitch-requestor";

function makeClient(responses: unknown[]): TwitchRequestor {
  let callIndex = 0;
  return {
    request: vi.fn(async () => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return resp;
    }),
  } as unknown as TwitchRequestor;
}

const GAME = {
  id: "g1",
  name: "Just Chatting",
  box_art_url: "https://img.twitch.tv/{width}x{height}/jc.jpg",
  igdb_id: "12345",
};

describe("getTopCategories", () => {
  it("returns transformed categories with cursor", async () => {
    const client = makeClient([{ data: [GAME], pagination: { cursor: "next" } }]);

    const result = await getTopCategories(client);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("g1");
    expect(result.data[0].platform).toBe("twitch");
    expect(result.data[0].name).toBe("Just Chatting");
    expect(result.cursor).toBe("next");
  });

  it("passes first and after params", async () => {
    const client = makeClient([{ data: [], pagination: {} }]);

    await getTopCategories(client, { first: 50, after: "cursor123" });

    const requestMock = client.request as ReturnType<typeof vi.fn>;
    const endpoint = requestMock.mock.calls[0][0] as string;
    expect(endpoint).toContain("first=50");
    expect(endpoint).toContain("after=cursor123");
  });

  it("defaults first to 20", async () => {
    const client = makeClient([{ data: [], pagination: {} }]);

    await getTopCategories(client);

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("first=20");
  });

  it("returns empty data with no cursor when no results", async () => {
    const client = makeClient([{ data: [], pagination: {} }]);

    const result = await getTopCategories(client);

    expect(result.data).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });
});

describe("getCategoryById", () => {
  it("returns the first category when found", async () => {
    const client = makeClient([{ data: [GAME] }]);

    const result = await getCategoryById(client, "g1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("g1");
    expect(result!.name).toBe("Just Chatting");
  });

  it("returns null when no category found", async () => {
    const client = makeClient([{ data: [] }]);

    const result = await getCategoryById(client, "nonexistent");

    expect(result).toBeNull();
  });

  it("passes the ID in the query", async () => {
    const client = makeClient([{ data: [] }]);

    await getCategoryById(client, "g999");

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("id=g999");
  });
});

describe("getCategoriesByIds", () => {
  it("returns empty array for empty input", async () => {
    const client = makeClient([]);

    const result = await getCategoriesByIds(client, []);

    expect(result).toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("returns transformed categories for multiple IDs", async () => {
    const game2 = { ...GAME, id: "g2", name: "Fortnite" };
    const client = makeClient([{ data: [GAME, game2] }]);

    const result = await getCategoriesByIds(client, ["g1", "g2"]);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("g1");
    expect(result[1].id).toBe("g2");
  });

  it("appends multiple id params", async () => {
    const client = makeClient([{ data: [] }]);

    await getCategoriesByIds(client, ["a", "b", "c"]);

    const endpoint = (client.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(endpoint).toContain("id=a");
    expect(endpoint).toContain("id=b");
    expect(endpoint).toContain("id=c");
  });

  it("rejects a response missing the Helix data array", async () => {
    const client = makeClient([{}]);

    await expect(getCategoriesByIds(client, ["g1"])).rejects.toThrow();
  });
});

describe("getAllTopCategories", () => {
  it("paginates until cursor is exhausted", async () => {
    const g1 = { ...GAME, id: "g1" };
    const g2 = { ...GAME, id: "g2" };
    const g3 = { ...GAME, id: "g3" };
    const client = makeClient([
      { data: [g1, g2], pagination: { cursor: "page2" } },
      { data: [g3], pagination: {} },
    ]);

    const result = await getAllTopCategories(client);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("g1");
    expect(result[2].id).toBe("g3");
  });

  it("stops when data is empty even with cursor", async () => {
    const client = makeClient([{ data: [], pagination: { cursor: "orphan" } }]);

    const result = await getAllTopCategories(client);

    expect(result).toEqual([]);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("stops at 5000 safety limit", async () => {
    const bulk = Array.from({ length: 100 }, (_, i) => ({
      ...GAME,
      id: `g${i}`,
    }));
    const client = makeClient([{ data: bulk, pagination: { cursor: "more" } }]);

    const result = await getAllTopCategories(client);

    expect(result.length).toBeLessThanOrEqual(5000);
  });
});
