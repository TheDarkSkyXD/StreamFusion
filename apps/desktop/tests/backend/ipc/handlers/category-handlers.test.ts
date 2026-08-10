import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@/backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getTopCategories: vi.fn(),
    getAllTopCategories: vi.fn(),
    getCategoryById: vi.fn(),
    searchCategories: vi.fn(),
  },
}));

vi.mock("@/backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getTopCategories: vi.fn(),
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
import type { UnifiedCategory } from "@/backend/api/unified/platform-types";
import type { DiscoveryResult } from "@/shared/discovery-types";

type CategoryTopResult = DiscoveryResult<UnifiedCategory[]>;

function category(id: string, name: string, platform: "twitch" | "kick"): UnifiedCategory {
  return { id, name, platform, boxArtUrl: "" };
}

type Handler = (event: unknown, params?: unknown) => Promise<unknown>;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

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

// Guards: bounded category loading uses one-page platform APIs and never exhausts either catalog before preview paint
// Guards: simultaneous consumers share one bounded platform request without turning later refreshes into permanent cache hits
// Guards: simultaneous exhaustive consumers share each platform catalog request instead of doubling rate-limit pressure
// Guards: combined category loading starts both platform requests concurrently and preserves partial results
describe("CATEGORIES_GET_TOP", () => {
  it("uses the bounded Twitch page contract when a limit is requested", async () => {
    const cats = [category("1", "Just Chatting", "twitch")];
    vi.mocked(twitchClient.getTopCategories).mockResolvedValue({
      data: cats,
      cursor: "twitch-page-2",
    });

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler(
      {},
      { platform: "twitch", limit: 12, cursor: "twitch-page-1" }
    )) as CategoryTopResult;

    expect(result).toEqual({
      success: true,
      platform: "twitch",
      data: cats,
      cursor: "twitch-page-2",
      providers: { twitch: "complete" },
    });
    expect(twitchClient.getTopCategories).toHaveBeenCalledWith({
      first: 12,
      after: "twitch-page-1",
    });
    expect(twitchClient.getAllTopCategories).not.toHaveBeenCalled();
  });

  it("uses the bounded Kick page contract when a limit is requested", async () => {
    const cats = [category("2", "Slots", "kick")];
    vi.mocked(kickClient.getTopCategories).mockResolvedValue({
      data: cats,
      cursor: "kick-page-2",
    });

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler(
      {},
      { platform: "kick", limit: 12, cursor: "kick-page-1" }
    )) as CategoryTopResult;

    expect(result).toEqual({
      success: true,
      platform: "kick",
      data: cats,
      cursor: "kick-page-2",
      providers: { kick: "complete" },
    });
    expect(kickClient.getTopCategories).toHaveBeenCalledWith({
      limit: 12,
      cursor: "kick-page-1",
    });
    expect(kickClient.getAllCategories).not.toHaveBeenCalled();
  });

  it("shares an in-flight bounded request across simultaneous consumers", async () => {
    const request = deferred<Awaited<ReturnType<typeof twitchClient.getTopCategories>>>();
    const cats = [category("1", "Just Chatting", "twitch")];
    vi.mocked(twitchClient.getTopCategories).mockReturnValue(request.promise);
    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);

    const first = handler({}, { platform: "twitch", limit: 12 });
    const second = handler({}, { platform: "twitch", limit: 12 });
    await vi.waitFor(() => expect(twitchClient.getTopCategories).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.resolve({ data: cats, cursor: "next" });

    await expect(first).resolves.toMatchObject({ success: true, data: cats });
    const secondResult = (await second) as CategoryTopResult;
    expect(secondResult).toEqual({
      success: true,
      platform: "twitch",
      data: cats,
      cursor: "next",
      providers: { twitch: "complete" },
    });
    expect(twitchClient.getTopCategories).toHaveBeenCalledTimes(1);

    vi.mocked(twitchClient.getTopCategories).mockResolvedValueOnce({ data: cats });
    await handler({}, { platform: "twitch", limit: 12 });
    expect(twitchClient.getTopCategories).toHaveBeenCalledTimes(2);
  });

  it("shares in-flight exhaustive requests across simultaneous consumers", async () => {
    const twitchRequest = deferred<Awaited<ReturnType<typeof twitchClient.getAllTopCategories>>>();
    const kickRequest = deferred<Awaited<ReturnType<typeof kickClient.getAllCategories>>>();
    const twitchCats = [category("1", "Just Chatting", "twitch")];
    const kickCats = [category("2", "Slots", "kick")];
    vi.mocked(twitchClient.getAllTopCategories).mockReturnValue(twitchRequest.promise);
    vi.mocked(kickClient.getAllCategories).mockReturnValue(kickRequest.promise);
    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);

    const first = handler({}, {});
    const second = handler({}, {});
    await vi.waitFor(() => expect(twitchClient.getAllTopCategories).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    twitchRequest.resolve(twitchCats);
    kickRequest.resolve(kickCats);

    await expect(first).resolves.toMatchObject({ data: [...twitchCats, ...kickCats] });
    await expect(second).resolves.toMatchObject({ data: [...twitchCats, ...kickCats] });
    expect(twitchClient.getAllTopCategories).toHaveBeenCalledTimes(1);
    expect(kickClient.getAllCategories).toHaveBeenCalledTimes(1);
  });

  it("returns only Twitch categories when platform=twitch", async () => {
    const cats = [{ id: "1", name: "Just Chatting" }];
    vi.mocked(twitchClient.getAllTopCategories).mockResolvedValue(cats as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, { platform: "twitch" })) as any;

    expect(result).toEqual({
      success: true,
      platform: "twitch",
      data: cats,
      providers: { twitch: "complete" },
    });
    expect(kickClient.getAllCategories).not.toHaveBeenCalled();
  });

  it("returns only Kick categories when platform=kick", async () => {
    const cats = [{ id: "2", name: "Slots" }];
    vi.mocked(kickClient.getAllCategories).mockResolvedValue(cats as any);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = (await handler({}, { platform: "kick" })) as any;

    expect(result).toEqual({
      success: true,
      platform: "kick",
      data: cats,
      providers: { kick: "complete" },
    });
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
    expect(result.providers).toEqual({ twitch: "complete", kick: "failed" });
  });

  it("starts both platform requests before either settles and keeps partial results", async () => {
    const twitchCats = [category("1", "Just Chatting", "twitch")];
    const twitchRequest = deferred<Awaited<ReturnType<typeof twitchClient.getAllTopCategories>>>();
    const kickRequest = deferred<never>();
    vi.mocked(twitchClient.getAllTopCategories).mockReturnValue(twitchRequest.promise);
    vi.mocked(kickClient.getAllCategories).mockReturnValue(kickRequest.promise);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const resultPromise = handler({}, {});

    await vi.waitFor(() => expect(twitchClient.getAllTopCategories).toHaveBeenCalledOnce());
    const kickStartedWhileTwitchWasPending = vi.mocked(kickClient.getAllCategories).mock.calls
      .length;

    twitchRequest.resolve(twitchCats);
    await vi.waitFor(() => expect(kickClient.getAllCategories).toHaveBeenCalledOnce());
    kickRequest.reject(new Error("Kick down"));

    const result = (await resultPromise) as CategoryTopResult;
    expect(kickStartedWhileTwitchWasPending).toBe(1);
    expect(result).toEqual({
      success: true,
      data: twitchCats,
      providers: { twitch: "complete", kick: "failed" },
    });
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
