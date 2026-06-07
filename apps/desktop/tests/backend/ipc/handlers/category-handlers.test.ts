import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getAllTopCategories: vi.fn(),
    getCategoryById: vi.fn(),
    searchCategories: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getAllCategories: vi.fn(),
    getCategoryById: vi.fn(),
    searchCategories: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-gql-client", () => ({
  gqlGetGameMetadata: vi.fn(),
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import { gqlGetGameMetadata } from "@/backend/api/platforms/twitch/twitch-gql-client";
import { registerCategoryHandlers } from "@/backend/ipc/handlers/category-handlers";

type Handler = (event: unknown, params?: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  registerCategoryHandlers();
});

describe("registerCategoryHandlers", () => {
  it("registers all four category IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.CATEGORIES_GET_TOP);
    expect(channels).toContain(IPC_CHANNELS.CATEGORIES_GET_BY_ID);
    expect(channels).toContain(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    expect(channels).toContain(IPC_CHANNELS.CATEGORIES_SEARCH);
  });
});

describe("CATEGORIES_GET_TOP", () => {
  it("returns only Twitch categories when platform=twitch", async () => {
    const cats = [{ id: "1", name: "Just Chatting" }];
    vi.mocked(twitchClient.getAllTopCategories).mockResolvedValue(cats as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result).toEqual({ success: true, platform: "twitch", data: cats });
    expect(kickClient.getAllCategories).not.toHaveBeenCalled();
  });

  it("returns only Kick categories when platform=kick", async () => {
    const cats = [{ id: "2", name: "Slots" }];
    vi.mocked(kickClient.getAllCategories).mockResolvedValue(cats as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, { platform: "kick" })) as any;

    expect(result).toEqual({ success: true, platform: "kick", data: cats });
    expect(twitchClient.getAllTopCategories).not.toHaveBeenCalled();
  });

  it("returns combined categories from both platforms when no platform specified", async () => {
    const twitchCats = [{ id: "1", name: "Just Chatting" }];
    const kickCats = [{ id: "2", name: "Slots" }];
    vi.mocked(twitchClient.getAllTopCategories).mockResolvedValue(twitchCats as any);
    vi.mocked(kickClient.getAllCategories).mockResolvedValue(kickCats as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, {})) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([...twitchCats, ...kickCats]);
  });

  it("returns partial results when one platform fails in combined mode", async () => {
    const twitchCats = [{ id: "1", name: "Just Chatting" }];
    vi.mocked(twitchClient.getAllTopCategories).mockResolvedValue(twitchCats as any);
    vi.mocked(kickClient.getAllCategories).mockRejectedValue(new Error("Kick down"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, {})) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual(twitchCats);
  });

  it("returns error when single-platform Twitch fetch fails", async () => {
    vi.mocked(twitchClient.getAllTopCategories).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result.success).toBe(false);
  });

  it("returns error when single-platform Kick fetch fails", async () => {
    vi.mocked(kickClient.getAllCategories).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, { platform: "kick" })) as any;

    expect(result.success).toBe(false);
  });
});

describe("CATEGORIES_GET_BY_ID", () => {
  it("fetches Twitch category by ID", async () => {
    const cat = { id: "123", name: "Valorant" };
    vi.mocked(twitchClient.getCategoryById).mockResolvedValue(cat as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_BY_ID);
    const result = (await handler({}, { platform: "twitch", categoryId: "123" })) as any;

    expect(result).toEqual({ success: true, data: cat });
  });

  it("fetches Kick category by ID", async () => {
    const cat = { id: "456", name: "Slots" };
    vi.mocked(kickClient.getCategoryById).mockResolvedValue(cat as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_BY_ID);
    const result = (await handler({}, { platform: "kick", categoryId: "456" })) as any;

    expect(result).toEqual({ success: true, data: cat });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.getCategoryById).mockRejectedValue(new Error("not found"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_BY_ID);
    const result = (await handler({}, { platform: "twitch", categoryId: "999" })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe("not found");
  });
});

describe("CATEGORIES_GET_METADATA", () => {
  it("returns tags from GQL for Twitch", async () => {
    vi.mocked(gqlGetGameMetadata).mockResolvedValue({ tags: ["FPS", "Competitive"] } as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = (await handler({}, { platform: "twitch", categoryId: "123" })) as any;

    expect(result).toEqual({ success: true, data: { tags: ["FPS", "Competitive"] } });
    expect(gqlGetGameMetadata).toHaveBeenCalledWith("123");
  });

  it("returns empty tags when GQL returns null", async () => {
    vi.mocked(gqlGetGameMetadata).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = (await handler({}, { platform: "twitch", categoryId: "123" })) as any;

    expect(result).toEqual({ success: true, data: { tags: [] } });
  });

  it("returns undefined tags for Kick (no-op)", async () => {
    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = (await handler({}, { platform: "kick", categoryId: "456" })) as any;

    expect(result).toEqual({ success: true, data: { tags: undefined } });
    expect(gqlGetGameMetadata).not.toHaveBeenCalled();
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(gqlGetGameMetadata).mockRejectedValue(new Error("gql fail"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = (await handler({}, { platform: "twitch", categoryId: "x" })) as any;

    expect(result.success).toBe(false);
  });
});

describe("CATEGORIES_SEARCH", () => {
  it("searches both platforms when no platform specified", async () => {
    const twitchCats = [{ id: "1", name: "Fortnite" }];
    const kickCats = [{ id: "2", name: "Fortnite Battle Royale" }];
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({
      data: twitchCats,
      cursor: "tc",
    } as any);
    vi.mocked(kickClient.searchCategories).mockResolvedValue({ data: kickCats } as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    const result = (await handler({}, { query: "fortnite" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([...twitchCats, ...kickCats]);
    expect(result.cursor).toBe("tc");
  });

  it("skips Kick on subsequent pages (params.after is set)", async () => {
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({
      data: [],
      cursor: undefined,
    } as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    await handler({}, { query: "test", after: "cursor-page-2" });

    expect(kickClient.searchCategories).not.toHaveBeenCalled();
  });

  it("returns single platform result when platform specified", async () => {
    vi.mocked(kickClient.searchCategories).mockResolvedValue({
      data: [{ id: "1", name: "Slots" }],
    } as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    const result = (await handler({}, { query: "slots", platform: "kick" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: "1", name: "Slots" }]);
    expect(twitchClient.searchCategories).not.toHaveBeenCalled();
  });

  it("gracefully handles Twitch search failure (inner catch), returning empty data", async () => {
    vi.mocked(twitchClient.searchCategories).mockRejectedValue(new Error("twitch down"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    const result = (await handler({}, { query: "x", platform: "twitch" })) as any;

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});
