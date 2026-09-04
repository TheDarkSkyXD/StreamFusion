import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("@backend/api/platforms/twitch/twitch-client", () => ({
  twitchClient: {
    getTopCategories: vi.fn(),
    getAllCategories: vi.fn(),
    getCategoryById: vi.fn(),
    searchCategories: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/kick/kick-client", () => ({
  kickClient: {
    getTopCategories: vi.fn(),
    getAllCategories: vi.fn(),
    getCategoryById: vi.fn(),
    searchCategories: vi.fn(),
  },
}));

vi.mock("@backend/api/platforms/twitch/twitch-gql-client", () => ({
  gqlGetGameMetadata: vi.fn(),
}));

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ipcMain } from "electron";

import { kickClient } from "@backend/api/platforms/kick/kick-client";
import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import { gqlGetGameMetadata } from "@backend/api/platforms/twitch/twitch-gql-client";
import { registerCategoryHandlers } from "@backend/ipc/handlers/category-handlers";
import type { UnifiedCategory } from "@shared/platform-types";
import { DiscoveryResult } from "@streamfusion/core/discovery";

type CategoryTopResult = DiscoveryResult<UnifiedCategory[]>;

function category(id: string, name: string, platform: "twitch" | "kick"): UnifiedCategory {
  return { id, name, platform, boxArtUrl: "" };
}

type HandlerResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  cursor?: string;
  providers?: Record<string, string>;
};
type Handler = (event: unknown, params?: unknown) => Promise<HandlerResult>;

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
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, params) => Promise.resolve(Reflect.apply(call[1], undefined, [event, params]));
}

beforeEach(() => {
  vi.clearAllMocks();
  registerCategoryHandlers({ readers: { twitch: twitchClient, kick: kickClient } });
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
      limit: 12,
      cursor: "twitch-page-1",
    });
    expect(twitchClient.getAllCategories).not.toHaveBeenCalled();
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
    const twitchRequest = deferred<Awaited<ReturnType<typeof twitchClient.getAllCategories>>>();
    const kickRequest = deferred<Awaited<ReturnType<typeof kickClient.getAllCategories>>>();
    const twitchCats = [category("1", "Just Chatting", "twitch")];
    const kickCats = [category("2", "Slots", "kick")];
    vi.mocked(twitchClient.getAllCategories).mockReturnValue(twitchRequest.promise);
    vi.mocked(kickClient.getAllCategories).mockReturnValue(kickRequest.promise);
    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);

    const first = handler({}, {});
    const second = handler({}, {});
    await vi.waitFor(() => expect(twitchClient.getAllCategories).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    twitchRequest.resolve(twitchCats);
    kickRequest.resolve(kickCats);

    await expect(first).resolves.toMatchObject({ data: [...twitchCats, ...kickCats] });
    await expect(second).resolves.toMatchObject({ data: [...twitchCats, ...kickCats] });
    expect(twitchClient.getAllCategories).toHaveBeenCalledTimes(1);
    expect(kickClient.getAllCategories).toHaveBeenCalledTimes(1);
  });

  it("returns only Twitch categories when platform=twitch", async () => {
    const cats = [category("1", "Just Chatting", "twitch")];
    vi.mocked(twitchClient.getAllCategories).mockResolvedValue(cats);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = await handler({}, { platform: "twitch" });

    expect(result).toEqual({
      success: true,
      platform: "twitch",
      data: cats,
      providers: { twitch: "complete" },
    });
    expect(kickClient.getAllCategories).not.toHaveBeenCalled();
  });

  it("returns only Kick categories when platform=kick", async () => {
    const cats = [category("2", "Slots", "kick")];
    vi.mocked(kickClient.getAllCategories).mockResolvedValue(cats);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = await handler({}, { platform: "kick" });

    expect(result).toEqual({
      success: true,
      platform: "kick",
      data: cats,
      providers: { kick: "complete" },
    });
    expect(twitchClient.getAllCategories).not.toHaveBeenCalled();
  });

  it("returns combined categories from both platforms when no platform specified", async () => {
    const twitchCats = [category("1", "Just Chatting", "twitch")];
    const kickCats = [category("2", "Slots", "kick")];
    vi.mocked(twitchClient.getAllCategories).mockResolvedValue(twitchCats);
    vi.mocked(kickClient.getAllCategories).mockResolvedValue(kickCats);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(result.data).toEqual([...twitchCats, ...kickCats]);
  });

  it("returns partial results when one platform fails in combined mode", async () => {
    const twitchCats = [category("1", "Just Chatting", "twitch")];
    vi.mocked(twitchClient.getAllCategories).mockResolvedValue(twitchCats);
    vi.mocked(kickClient.getAllCategories).mockRejectedValue(new Error("Kick down"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = await handler({}, {});

    expect(result.success).toBe(true);
    expect(result.data).toEqual(twitchCats);
    expect(result.providers).toEqual({ twitch: "complete", kick: "failed" });
  });

  it("starts both platform requests before either settles and keeps partial results", async () => {
    const twitchCats = [category("1", "Just Chatting", "twitch")];
    const twitchRequest = deferred<Awaited<ReturnType<typeof twitchClient.getAllCategories>>>();
    const kickRequest = deferred<never>();
    vi.mocked(twitchClient.getAllCategories).mockReturnValue(twitchRequest.promise);
    vi.mocked(kickClient.getAllCategories).mockReturnValue(kickRequest.promise);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const resultPromise = handler({}, {});

    await vi.waitFor(() => expect(twitchClient.getAllCategories).toHaveBeenCalledOnce());
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
    vi.mocked(twitchClient.getAllCategories).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = await handler({}, { platform: "twitch" });

    expect(result.success).toBe(false);
  });

  it("returns error when single-platform Kick fetch fails", async () => {
    vi.mocked(kickClient.getAllCategories).mockRejectedValue(new Error("fail"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_TOP);
    const result = await handler({}, { platform: "kick" });

    expect(result.success).toBe(false);
  });
});

describe("CATEGORIES_GET_BY_ID", () => {
  it("fetches Twitch category by ID", async () => {
    const cat = category("123", "Valorant", "twitch");
    vi.mocked(twitchClient.getCategoryById).mockResolvedValue(cat);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_BY_ID);
    const result = await handler({}, { platform: "twitch", categoryId: "123" });

    expect(result).toEqual({ success: true, data: cat });
  });

  it("fetches Kick category by ID", async () => {
    const cat = category("456", "Slots", "kick");
    vi.mocked(kickClient.getCategoryById).mockResolvedValue(cat);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_BY_ID);
    const result = await handler({}, { platform: "kick", categoryId: "456" });

    expect(result).toEqual({ success: true, data: cat });
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(twitchClient.getCategoryById).mockRejectedValue(new Error("not found"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_BY_ID);
    const result = await handler({}, { platform: "twitch", categoryId: "999" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("not found");
  });
});

describe("CATEGORIES_GET_METADATA", () => {
  it("returns tags from GQL for Twitch", async () => {
    vi.mocked(gqlGetGameMetadata).mockResolvedValue({ tags: ["FPS", "Competitive"] });

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = await handler({}, { platform: "twitch", categoryId: "123" });

    expect(result).toEqual({ success: true, data: { tags: ["FPS", "Competitive"] } });
    expect(gqlGetGameMetadata).toHaveBeenCalledWith("123");
  });

  it("returns empty tags when GQL returns null", async () => {
    vi.mocked(gqlGetGameMetadata).mockResolvedValue(null);

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = (await handler({}, { platform: "twitch", categoryId: "123" })) as unknown;

    expect(result).toEqual({ success: true, data: { tags: [] } });
  });

  it("returns undefined tags for Kick (no-op)", async () => {
    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = await handler({}, { platform: "kick", categoryId: "456" });

    expect(result).toEqual({ success: true, data: { tags: undefined } });
    expect(gqlGetGameMetadata).not.toHaveBeenCalled();
  });

  it("returns error envelope on failure", async () => {
    vi.mocked(gqlGetGameMetadata).mockRejectedValue(new Error("gql fail"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_GET_METADATA);
    const result = await handler({}, { platform: "twitch", categoryId: "x" });

    expect(result.success).toBe(false);
  });
});

describe("CATEGORIES_SEARCH", () => {
  it("searches both platforms when no platform specified", async () => {
    const twitchCats = [category("1", "Fortnite", "twitch")];
    const kickCats = [category("2", "Fortnite Battle Royale", "kick")];
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({
      data: twitchCats,
      cursor: "tc",
    });
    vi.mocked(kickClient.searchCategories).mockResolvedValue({ data: kickCats });

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    const result = await handler({}, { query: "fortnite" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([...twitchCats, ...kickCats]);
    expect(result.cursor).toBe("tc");
    expect(result.providers).toEqual({ twitch: "complete", kick: "complete" });
  });

  it("skips Kick on subsequent pages (params.after is set)", async () => {
    vi.mocked(twitchClient.searchCategories).mockResolvedValue({
      data: [],
      cursor: undefined,
    });

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    await handler({}, { query: "test", after: "cursor-page-2" });

    expect(kickClient.searchCategories).not.toHaveBeenCalled();
  });

  it("returns single platform result when platform specified", async () => {
    vi.mocked(kickClient.searchCategories).mockResolvedValue({
      data: [category("1", "Slots", "kick")],
    });

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    const result = await handler({}, { query: "slots", platform: "kick" });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([category("1", "Slots", "kick")]);
    expect(twitchClient.searchCategories).not.toHaveBeenCalled();
    expect(kickClient.searchCategories).toHaveBeenCalledWith("slots", { limit: 20 });
  });

  it("returns a failed provider result instead of disguising a Twitch failure as empty data", async () => {
    vi.mocked(twitchClient.searchCategories).mockRejectedValue(new Error("twitch down"));

    const handler = getHandler(IPC_CHANNELS.CATEGORIES_SEARCH);
    const result = await handler({}, { query: "x", platform: "twitch" });

    expect(result).toEqual({
      success: false,
      error: "Couldn’t search categories on the selected platforms",
      providers: { twitch: "failed" },
    });
  });
});
