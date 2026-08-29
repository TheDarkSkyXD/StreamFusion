import { describe, expect, it, vi } from "vitest";
import {
  createTimeoutModerationService,
  type TimeoutAuthorityAdapter,
} from "@backend/services/moderation/timeout-moderation-service";

// Guards: a Timeout snapshot is issued only from a positively verified Platform actor and target state.
// Guards: snapshot identity binds the exact Platform, Channel, target, selected message, actor, and action.
// Guards: replacing or consuming a snapshot physically cancels its owned expiry timer.
// Guards: a replacement snapshot survives its predecessor's deadline and expires on its own deadline.
// Guards: expiry during an active submission is deferred and retryable failure starts a fresh TTL.
describe("timeout moderation service", () => {
  it("issues an opaque snapshot for an exact verified timeout target", async () => {
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi.fn().mockResolvedValue({
        state: "verified",
        actor: { id: "mod-7", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      }),
      executeTimeout: vi.fn(),
    };
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      now: () => 1_000,
      createId: () => "snapshot-secret",
    });
    const binding = {
      platform: "twitch" as const,
      channelId: "channel-1",
      channelSlug: "streamer",
      targetUserId: "target-9",
      targetUsername: "viewer",
      selectedMessageId: "message-3",
      action: "timeout" as const,
    };

    await expect(service.createSnapshot(binding)).resolves.toEqual({
      state: "available",
      snapshotId: "snapshot-secret",
      verifiedAt: 1_000,
      actorRole: "moderator",
      policy: {
        durationUnit: "seconds",
        minDuration: 1,
        maxDuration: 1_209_600,
        supportsReason: true,
        maxReasonLength: 500,
      },
    });
    expect(adapter.inspectTimeoutTarget).toHaveBeenCalledWith(binding);
    expect(service.getSnapshotForTest("snapshot-secret")).toMatchObject({
      binding,
      actor: { id: "mod-7", role: "moderator" },
      verifiedAt: 1_000,
    });
  });

  it("fails closed without retaining a snapshot when Platform state is unverifiable", async () => {
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi
        .fn()
        .mockResolvedValue({ state: "unavailable", reason: "unverifiable" }),
      executeTimeout: vi.fn(),
    };
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      createId: () => "must-not-be-used",
    });

    await expect(
      service.createSnapshot({
        platform: "kick",
        channelId: "21",
        channelSlug: "creator",
        targetUserId: "88",
        targetUsername: "viewer",
        action: "timeout",
      })
    ).resolves.toEqual({ state: "unavailable", reason: "unverifiable" });
    expect(service.getSnapshotForTest("must-not-be-used")).toBeUndefined();
  });

  it("revalidates the exact binding and uses the authenticated moderator identity on submit", async () => {
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi.fn().mockResolvedValue({
        state: "verified",
        actor: { id: "actual-mod", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      }),
      executeTimeout: vi.fn().mockResolvedValue({ ok: true }),
    };
    const ids = ["snapshot-1", "attempt-1"];
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      now: () => 1_000,
      createId: () => ids.shift()!,
    });
    const binding = {
      platform: "twitch" as const,
      channelId: "channel-1",
      channelSlug: "streamer",
      targetUserId: "target-9",
      targetUsername: "viewer",
      selectedMessageId: "message-3",
      action: "timeout" as const,
    };
    await service.createSnapshot(binding);

    await expect(
      service.submitTimeout({
        snapshotId: "snapshot-1",
        duration: 600,
        reason: "Repeated spam",
      })
    ).resolves.toEqual({ state: "success", attemptId: "attempt-1" });
    expect(adapter.inspectTimeoutTarget).toHaveBeenNthCalledWith(2, binding);
    expect(adapter.executeTimeout).toHaveBeenCalledWith({
      binding,
      actor: { id: "actual-mod", role: "moderator" },
      duration: 600,
      reason: "Repeated spam",
    });
  });

  it("cancels the attempt when current target state changes after confirmation", async () => {
    const inspectTimeoutTarget = vi
      .fn()
      .mockResolvedValueOnce({
        state: "verified",
        actor: { id: "mod-7", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "minutes",
          minDuration: 1,
          maxDuration: 10_080,
          supportsReason: true,
          maxReasonLength: 100,
        },
      })
      .mockResolvedValueOnce({ state: "unavailable", reason: "invalid-target-state" });
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget,
      executeTimeout: vi.fn(),
    };
    const ids = ["snapshot-1", "attempt-2"];
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      createId: () => ids.shift()!,
    });
    await service.createSnapshot({
      platform: "kick",
      channelId: "21",
      channelSlug: "creator",
      targetUserId: "88",
      targetUsername: "viewer",
      action: "timeout",
    });

    await expect(
      service.submitTimeout({ snapshotId: "snapshot-1", duration: 10 })
    ).resolves.toEqual({
      state: "revalidation-required",
      attemptId: "attempt-2",
      reason: "state-changed",
    });
    expect(adapter.executeTimeout).not.toHaveBeenCalled();
    expect(service.getSnapshotForTest("snapshot-1")).toBeUndefined();
  });

  it("rejects durations and reasons outside the verified Platform policy", async () => {
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi.fn().mockResolvedValue({
        state: "verified",
        actor: { id: "kick-mod", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "minutes",
          minDuration: 1,
          maxDuration: 10_080,
          supportsReason: true,
          maxReasonLength: 100,
        },
      }),
      executeTimeout: vi.fn(),
    };
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      createId: () => "snapshot-1",
    });
    await service.createSnapshot({
      platform: "kick",
      channelId: "21",
      channelSlug: "creator",
      targetUserId: "88",
      targetUsername: "viewer",
      action: "timeout",
    });

    await expect(
      service.submitTimeout({ snapshotId: "snapshot-1", duration: 0.5 })
    ).resolves.toEqual({
      state: "invalid-input",
      field: "duration",
      message: "Enter a whole number from 1 to 10080 minutes.",
    });
    await expect(
      service.submitTimeout({ snapshotId: "snapshot-1", duration: 10, reason: "x".repeat(101) })
    ).resolves.toEqual({
      state: "invalid-input",
      field: "reason",
      message: "Reason must be 100 characters or fewer.",
    });
    expect(adapter.inspectTimeoutTarget).toHaveBeenCalledTimes(1);
    expect(adapter.executeTimeout).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent submissions into one correlated attempt", async () => {
    let finishMutation!: (value: { ok: true }) => void;
    const mutation = new Promise<{ ok: true }>((resolve) => {
      finishMutation = resolve;
    });
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi.fn().mockResolvedValue({
        state: "verified",
        actor: { id: "mod-7", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      }),
      executeTimeout: vi.fn().mockReturnValue(mutation),
    };
    const ids = ["snapshot-1", "attempt-1"];
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      createId: () => ids.shift()!,
    });
    await service.createSnapshot({
      platform: "twitch",
      channelId: "channel-1",
      channelSlug: "streamer",
      targetUserId: "target-9",
      targetUsername: "viewer",
      action: "timeout",
    });

    const first = service.submitTimeout({ snapshotId: "snapshot-1", duration: 600 });
    const duplicate = service.submitTimeout({ snapshotId: "snapshot-1", duration: 600 });
    finishMutation({ ok: true });

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { state: "success", attemptId: "attempt-1" },
      { state: "success", attemptId: "attempt-1" },
    ]);
    expect(adapter.inspectTimeoutTarget).toHaveBeenCalledTimes(2);
    expect(adapter.executeTimeout).toHaveBeenCalledTimes(1);
  });

  it("expires a stale snapshot and requires a fresh confirmation", async () => {
    let now = 1_000;
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi.fn().mockResolvedValue({
        state: "verified",
        actor: { id: "mod-7", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      }),
      executeTimeout: vi.fn(),
    };
    const ids = ["snapshot-1", "attempt-1"];
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      now: () => now,
      createId: () => ids.shift()!,
    });
    await service.createSnapshot({
      platform: "twitch",
      channelId: "channel-1",
      channelSlug: "streamer",
      targetUserId: "target-9",
      targetUsername: "viewer",
      action: "timeout",
    });
    now += 30_001;

    await expect(
      service.submitTimeout({ snapshotId: "snapshot-1", duration: 600 })
    ).resolves.toEqual({
      state: "revalidation-required",
      attemptId: "attempt-1",
      reason: "stale-snapshot",
    });
    expect(adapter.inspectTimeoutTarget).toHaveBeenCalledTimes(1);
    expect(adapter.executeTimeout).not.toHaveBeenCalled();
  });

  it("automatically removes an abandoned snapshot when its verification expires", async () => {
    vi.useFakeTimers();
    try {
      const adapter: TimeoutAuthorityAdapter = {
        inspectTimeoutTarget: vi.fn().mockResolvedValue({
          state: "verified",
          actor: { id: "mod-7", role: "moderator" },
          target: { state: "clear" },
          policy: {
            durationUnit: "seconds",
            minDuration: 1,
            maxDuration: 1_209_600,
            supportsReason: true,
            maxReasonLength: 500,
          },
        }),
        executeTimeout: vi.fn(),
      };
      const service = createTimeoutModerationService({
        adapters: { twitch: adapter, kick: adapter },
        createId: () => "abandoned-snapshot",
      });
      await service.createSnapshot({
        platform: "twitch",
        channelId: "channel-1",
        channelSlug: "streamer",
        targetUserId: "target-9",
        targetUsername: "viewer",
        action: "timeout",
      });

      expect(service.getSnapshotForTest("abandoned-snapshot")).toBeDefined();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(service.getSnapshotForTest("abandoned-snapshot")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the owned expiry timer when a snapshot is replaced and then consumed", async () => {
    vi.useFakeTimers();
    try {
      const adapter: TimeoutAuthorityAdapter = {
        inspectTimeoutTarget: vi.fn().mockResolvedValue({
          state: "verified",
          actor: { id: "mod-7", role: "moderator" },
          target: { state: "clear" },
          policy: {
            durationUnit: "seconds",
            minDuration: 1,
            maxDuration: 1_209_600,
            supportsReason: true,
            maxReasonLength: 500,
          },
        }),
        executeTimeout: vi.fn().mockResolvedValue({ ok: true }),
      };
      const ids = ["snapshot-1", "snapshot-1", "attempt-1"];
      const service = createTimeoutModerationService({
        adapters: { twitch: adapter, kick: adapter },
        createId: () => ids.shift()!,
      });
      const binding = {
        platform: "twitch" as const,
        channelId: "channel-1",
        channelSlug: "streamer",
        targetUserId: "target-9",
        targetUsername: "viewer",
        action: "timeout" as const,
      };

      await service.createSnapshot(binding);
      expect(vi.getTimerCount()).toBe(1);

      await service.createSnapshot(binding);
      expect(vi.getTimerCount()).toBe(1);

      await expect(
        service.submitTimeout({ snapshotId: "snapshot-1", duration: 600 })
      ).resolves.toEqual({ state: "success", attemptId: "attempt-1" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a replaced cleanup expire the current snapshot", async () => {
    vi.useFakeTimers();
    try {
      const adapter: TimeoutAuthorityAdapter = {
        inspectTimeoutTarget: vi.fn().mockResolvedValue({
          state: "verified",
          actor: { id: "mod-7", role: "moderator" },
          target: { state: "clear" },
          policy: {
            durationUnit: "seconds",
            minDuration: 1,
            maxDuration: 1_209_600,
            supportsReason: true,
            maxReasonLength: 500,
          },
        }),
        executeTimeout: vi.fn(),
      };
      const service = createTimeoutModerationService({
        adapters: { twitch: adapter, kick: adapter },
        createId: () => "snapshot-1",
      });
      const binding = {
        platform: "twitch" as const,
        channelId: "channel-1",
        channelSlug: "streamer",
        targetUserId: "target-9",
        targetUsername: "viewer",
        action: "timeout" as const,
      };

      await service.createSnapshot(binding);
      await vi.advanceTimersByTimeAsync(10_000);
      await service.createSnapshot(binding);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(service.getSnapshotForTest("snapshot-1")).toBeDefined();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(service.getSnapshotForTest("snapshot-1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reschedules expiry when the TTL elapses during a retryable submission", async () => {
    vi.useFakeTimers();
    try {
      const inspection = {
        state: "verified" as const,
        actor: { id: "mod-7", role: "moderator" as const },
        target: { state: "clear" as const },
        policy: {
          durationUnit: "seconds" as const,
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      };
      let finishRevalidation!: (value: typeof inspection) => void;
      const revalidation = new Promise<typeof inspection>((resolve) => {
        finishRevalidation = resolve;
      });
      const adapter: TimeoutAuthorityAdapter = {
        inspectTimeoutTarget: vi
          .fn()
          .mockResolvedValueOnce(inspection)
          .mockReturnValueOnce(revalidation),
        executeTimeout: vi.fn().mockResolvedValue({
          ok: false,
          code: "network",
          safeMessage: "Try again.",
        }),
      };
      const ids = ["snapshot-1", "attempt-1"];
      const service = createTimeoutModerationService({
        adapters: { twitch: adapter, kick: adapter },
        createId: () => ids.shift()!,
      });
      await service.createSnapshot({
        platform: "twitch",
        channelId: "channel-1",
        channelSlug: "streamer",
        targetUserId: "target-9",
        targetUsername: "viewer",
        action: "timeout",
      });

      const submission = service.submitTimeout({ snapshotId: "snapshot-1", duration: 600 });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(service.getSnapshotForTest("snapshot-1")).toBeDefined();
      expect(vi.getTimerCount()).toBe(1);

      finishRevalidation(inspection);
      await expect(submission).resolves.toMatchObject({ state: "failure", code: "network" });

      await vi.advanceTimersByTimeAsync(29_999);
      expect(service.getSnapshotForTest("snapshot-1")).toBeDefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(service.getSnapshotForTest("snapshot-1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds abandoned snapshots and evicts the oldest opening first", async () => {
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi.fn().mockResolvedValue({
        state: "verified",
        actor: { id: "mod-7", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      }),
      executeTimeout: vi.fn(),
    };
    let nextId = 0;
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      createId: () => `snapshot-${++nextId}`,
      maxSnapshots: 2,
    });
    const binding = {
      platform: "twitch" as const,
      channelId: "channel-1",
      channelSlug: "streamer",
      targetUserId: "target-9",
      targetUsername: "viewer",
      action: "timeout" as const,
    };

    await service.createSnapshot(binding);
    await service.createSnapshot(binding);
    await service.createSnapshot(binding);

    expect(service.getSnapshotForTest("snapshot-1")).toBeUndefined();
    expect(service.getSnapshotForTest("snapshot-2")).toBeDefined();
    expect(service.getSnapshotForTest("snapshot-3")).toBeDefined();
  });

  it("awaits history persistence before success and sanitizes retryable failures", async () => {
    const adapter: TimeoutAuthorityAdapter = {
      inspectTimeoutTarget: vi.fn().mockResolvedValue({
        state: "verified",
        actor: { id: "mod-7", role: "moderator" },
        target: { state: "clear" },
        policy: {
          durationUnit: "seconds",
          minDuration: 1,
          maxDuration: 1_209_600,
          supportsReason: true,
          maxReasonLength: 500,
        },
      }),
      executeTimeout: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          code: "forbidden",
          safeMessage: "Twitch rejected this timeout. Check your moderation access and try again.",
        })
        .mockResolvedValueOnce({ ok: true }),
    };
    const persistSuccess = vi.fn().mockResolvedValue(undefined);
    const ids = ["snapshot-1", "attempt-1", "attempt-2"];
    const service = createTimeoutModerationService({
      adapters: { twitch: adapter, kick: adapter },
      createId: () => ids.shift()!,
      persistSuccess,
    });
    await service.createSnapshot({
      platform: "twitch",
      channelId: "channel-1",
      channelSlug: "streamer",
      targetUserId: "target-9",
      targetUsername: "viewer",
      action: "timeout",
    });

    await expect(
      service.submitTimeout({ snapshotId: "snapshot-1", duration: 600, reason: "Spam" })
    ).resolves.toEqual({
      state: "failure",
      attemptId: "attempt-1",
      code: "forbidden",
      message: "Twitch rejected this timeout. Check your moderation access and try again.",
    });
    expect(service.getSnapshotForTest("snapshot-1")).toBeDefined();

    await expect(
      service.submitTimeout({ snapshotId: "snapshot-1", duration: 600, reason: "Spam" })
    ).resolves.toEqual({ state: "success", attemptId: "attempt-2" });
    expect(persistSuccess).toHaveBeenCalledWith({
      attemptId: "attempt-2",
      actor: { id: "mod-7", role: "moderator" },
      binding: expect.objectContaining({ targetUserId: "target-9" }),
      duration: 600,
      reason: "Spam",
    });
    expect(adapter.executeTimeout).toHaveBeenCalledTimes(2);
  });
});
