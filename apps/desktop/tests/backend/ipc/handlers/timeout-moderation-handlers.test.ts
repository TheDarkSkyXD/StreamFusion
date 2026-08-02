import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  app: { isPackaged: false },
  handle: vi.fn(),
}));

vi.mock("electron", () => ({
  app: electronMocks.app,
  ipcMain: { handle: electronMocks.handle },
}));

import { ipcMain } from "electron";

import { registerTimeoutModerationHandlers } from "@/backend/ipc/handlers/timeout-moderation-handlers";
import { IPC_CHANNELS } from "@/shared/ipc-channels";

type Handler = (event: { senderFrame?: { url?: string } }, payload: unknown) => Promise<unknown>;

function handlerFor(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`Missing handler for ${channel}`);
  return call[1] as Handler;
}

const binding = {
  platform: "twitch",
  channelId: "100",
  channelSlug: "streamer",
  targetUserId: "300",
  targetUsername: "viewer",
  selectedMessageId: "message-4",
  action: "timeout",
};

beforeEach(() => {
  vi.clearAllMocks();
  electronMocks.app.isPackaged = false;
});

// Guards: Electron development moderation fixtures match browser fixture states without production API calls.
// Guards: packaged production ignores all fixture query parameters and uses the real moderation service.
// Guards: absent, malformed, and unauthorized sender URLs cannot opt into privileged fixture behavior.
describe("timeout moderation IPC handlers", () => {
  it("serves the timeout-valid development snapshot without calling production", async () => {
    const service = {
      createSnapshot: vi.fn(),
      submitTimeout: vi.fn(),
    };
    registerTimeoutModerationHandlers(service);
    const event = {
      senderFrame: {
        url: "http://localhost:5173/browser.html?moderationFixture=timeout-valid",
      },
    };

    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT)(event, binding)
    ).resolves.toMatchObject({
      state: "available",
      snapshotId: "development-timeout-snapshot",
      actorRole: "moderator",
      policy: { durationUnit: "seconds", minDuration: 1, maxDuration: 1_209_600 },
    });
    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT)(event, {
        snapshotId: "development-timeout-snapshot",
        duration: 600,
      })
    ).resolves.toEqual({
      state: "success",
      attemptId: "development-success-attempt",
    });
    expect(service.createSnapshot).not.toHaveBeenCalled();
    expect(service.submitTimeout).not.toHaveBeenCalled();
  });

  it("serves the timeout-unverifiable development snapshot", async () => {
    const service = {
      createSnapshot: vi.fn(),
      submitTimeout: vi.fn(),
    };
    registerTimeoutModerationHandlers(service);
    const event = {
      senderFrame: {
        url: "http://localhost:5173/browser.html?moderationFixture=timeout-unverifiable",
      },
    };

    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT)(event, binding)
    ).resolves.toEqual({ state: "unavailable", reason: "unverifiable" });
    expect(service.createSnapshot).not.toHaveBeenCalled();
  });

  it("serves timeout-success development submission without calling production", async () => {
    const service = {
      createSnapshot: vi.fn(),
      submitTimeout: vi.fn(),
    };
    registerTimeoutModerationHandlers(service);
    const event = {
      senderFrame: {
        url: "http://localhost:5173/browser.html?moderationFixture=timeout-success",
      },
    };

    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT)(event, {
        snapshotId: "development-timeout-snapshot",
        duration: 600,
        reason: "Spam",
      })
    ).resolves.toEqual({
      state: "success",
      attemptId: "development-success-attempt",
    });
    expect(service.submitTimeout).not.toHaveBeenCalled();
  });

  it("preserves the timeout-pending development submission until its fixture settles", async () => {
    vi.useFakeTimers();
    try {
      const service = {
        createSnapshot: vi.fn(),
        submitTimeout: vi.fn(),
      };
      registerTimeoutModerationHandlers(service);
      const event = {
        senderFrame: {
          url: "http://localhost:5173/browser.html?moderationFixture=timeout-pending",
        },
      };

      let settled = false;
      const pending = handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT)(event, {
        snapshotId: "development-timeout-snapshot",
        duration: 600,
      }).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual({
        state: "success",
        attemptId: "development-pending-attempt",
      });
      expect(service.submitTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves the timeout-failure development submission without calling production", async () => {
    const service = {
      createSnapshot: vi.fn(),
      submitTimeout: vi.fn(),
    };
    registerTimeoutModerationHandlers(service);
    const event = {
      senderFrame: {
        url: "http://localhost:5173/browser.html?moderationFixture=timeout-failure",
      },
    };

    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT)(event, {
        snapshotId: "development-timeout-snapshot",
        duration: 600,
      })
    ).resolves.toEqual({
      state: "failure",
      attemptId: "development-failure-attempt",
      code: "forbidden",
      message: "Kick rejected this timeout. Check your moderation access and try again.",
    });
    expect(service.submitTimeout).not.toHaveBeenCalled();
  });

  it("bypasses fixture routing in packaged production for snapshot and submit", async () => {
    electronMocks.app.isPackaged = true;
    const productionSnapshot = {
      state: "available",
      snapshotId: "production-snapshot",
      verifiedAt: 1,
      actorRole: "moderator",
      policy: {
        durationUnit: "seconds",
        minDuration: 1,
        maxDuration: 1_209_600,
        supportsReason: true,
        maxReasonLength: 500,
      },
    };
    const service = {
      createSnapshot: vi.fn().mockResolvedValue(productionSnapshot),
      submitTimeout: vi
        .fn()
        .mockResolvedValue({ state: "success", attemptId: "production-attempt" }),
    };
    registerTimeoutModerationHandlers(service);
    const event = {
      senderFrame: {
        url: "http://localhost:5173/browser.html?moderationFixture=timeout-failure",
      },
    };

    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT)(event, binding)
    ).resolves.toEqual(productionSnapshot);
    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT)(event, {
        snapshotId: "production-snapshot",
        duration: 600,
      })
    ).resolves.toEqual({ state: "success", attemptId: "production-attempt" });
    expect(service.createSnapshot).toHaveBeenCalledWith(binding);
    expect(service.submitTimeout).toHaveBeenCalledWith({
      snapshotId: "production-snapshot",
      duration: 600,
    });
  });

  it("does not let absent or malformed sender URLs opt into fixtures", async () => {
    const service = {
      createSnapshot: vi.fn(),
      submitTimeout: vi.fn(),
    };
    registerTimeoutModerationHandlers(service);
    const snapshot = handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT);
    const submit = handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT);

    await expect(snapshot({}, binding)).resolves.toEqual({
      state: "unavailable",
      reason: "unauthorized",
    });
    await expect(
      submit(
        { senderFrame: { url: "not-a-url?moderationFixture=timeout-success" } },
        { snapshotId: "development-timeout-snapshot", duration: 600 }
      )
    ).resolves.toMatchObject({ state: "failure", code: "unauthorized" });
    expect(service.createSnapshot).not.toHaveBeenCalled();
    expect(service.submitTimeout).not.toHaveBeenCalled();
  });

  it("origin-checks and validates the exact main-owned snapshot and submit seams", async () => {
    const service = {
      createSnapshot: vi.fn().mockResolvedValue({
        state: "available",
        snapshotId: "opaque",
        verifiedAt: 1,
        actorRole: "moderator",
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      }),
      submitTimeout: vi.fn().mockResolvedValue({ state: "success", attemptId: "attempt-1" }),
    };
    registerTimeoutModerationHandlers(service);
    const allowed = { senderFrame: { url: "http://localhost:5173/browser.html" } };
    const denied = { senderFrame: { url: "https://attacker.example/" } };
    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT)(allowed, binding)
    ).resolves.toMatchObject({ state: "available", snapshotId: "opaque" });
    expect(service.createSnapshot).toHaveBeenCalledWith(binding);
    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SUBMIT)(allowed, {
        snapshotId: "opaque",
        duration: 600,
        reason: "Spam",
      })
    ).resolves.toEqual({ state: "success", attemptId: "attempt-1" });
    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT)(denied, binding)
    ).resolves.toEqual({ state: "unavailable", reason: "unauthorized" });
    await expect(
      handlerFor(IPC_CHANNELS.MODERATION_TIMEOUT_SNAPSHOT)(allowed, {
        ...binding,
        platform: "youtube",
      })
    ).resolves.toEqual({ state: "unavailable", reason: "unverifiable" });
    expect(service.createSnapshot).toHaveBeenCalledTimes(1);
  });
});
