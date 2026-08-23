import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  exposedApi: undefined as any,
  exposeInMainWorld: vi.fn((name: string, api: unknown) => {
    if (name === "electronAPI") electronMocks.exposedApi = api;
  }),
  invoke: vi.fn(),
}));

vi.mock("@/preload/ipc-feature-loader", () => ({
  createFeatureAwareIpc: (invoke: unknown, send: unknown) => ({
    invoke,
    send,
    loadFeature: vi.fn(async () => undefined),
  }),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
    sendSync: vi.fn(() => []),
  },
}));

beforeAll(async () => {
  await import("@/preload/index");
});

beforeEach(() => {
  electronMocks.invoke.mockReset();
});

// Guards: Category Clips cross the renderer boundary through a typed, named IPC method.
describe("preload Category media boundary", () => {
  it("forwards Category Clip requests without changing their native category identity", async () => {
    const request = {
      platform: "kick" as const,
      categoryId: "15",
      categorySlug: "just-chatting",
      categoryName: "Just Chatting",
      limit: 20,
      sort: "views" as const,
      timeRange: "all" as const,
    };
    const response = { success: true, availability: "available", data: [] };
    electronMocks.invoke.mockResolvedValueOnce(response);

    await expect(electronMocks.exposedApi.clips.getByCategory(request)).resolves.toBe(response);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.CLIPS_GET_BY_CATEGORY,
      request
    );
  });

  it("forwards Category Video requests without changing their native category identity", async () => {
    const request = {
      platform: "twitch" as const,
      categoryId: "509658",
      categoryName: "Just Chatting",
      limit: 20,
      sort: "views" as const,
    };
    const response = { success: true, availability: "available", data: [] };
    electronMocks.invoke.mockResolvedValueOnce(response);

    await expect(electronMocks.exposedApi.videos.getByCategory(request)).resolves.toBe(response);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.VIDEOS_GET_BY_CATEGORY,
      request
    );
  });
});
