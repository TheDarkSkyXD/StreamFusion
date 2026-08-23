import { beforeAll, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";
import type { TimeoutActionBinding } from "@/shared/timeout-moderation-types";

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

describe("preload timeout moderation", () => {
  it("forwards snapshot and submit requests over their typed IPC channels", async () => {
    const binding: TimeoutActionBinding = {
      platform: "twitch",
      channelId: "channel-1",
      channelSlug: "channel",
      action: "timeout",
      targetUserId: "target-1",
      targetUsername: "target",
      selectedMessageId: "message-1",
    };

    await electronMocks.exposedApi.moderation.createTimeoutSnapshot(binding);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT,
      binding
    );

    const input = { snapshotId: "snapshot-1", duration: 600, reason: "spam" };
    await electronMocks.exposedApi.moderation.submitTimeout(input);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT,
      input
    );
  });
});
