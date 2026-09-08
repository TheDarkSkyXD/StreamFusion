import { describe, expect, it, vi } from "vitest";

import {
  twitchAccountId,
  twitchAttemptId,
  twitchCredentialGeneration,
  type TwitchCredential,
  type TwitchCredentialRepository,
  type TwitchCredentialSnapshot,
  type TwitchDeviceAuthorizationGateway,
} from "@streamfusion/core/auth";

import { createTwitchAccountSessionController } from "../domain/twitch-account-session-controller";
import { createSecureTwitchCredentialRepository } from "../data/secure-twitch-credential-repository";
import type { SecureSecretStore } from "../../storage/capabilities/persistence";

function secrets(): SecureSecretStore & {
  failNextReadback: boolean;
  failReadbackOnNextSet: boolean;
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    failNextReadback: false,
    failReadbackOnNextSet: false,
    delete: async (key) => void values.delete(key),
    get: async function (key) {
      if (this.failNextReadback) {
        this.failNextReadback = false;
        return "corrupt-readback";
      }
      return values.get(key) ?? null;
    },
    isAvailable: async () => true,
    set: async function (key, value) {
      values.set(key, value);
      if (this.failReadbackOnNextSet) {
        this.failReadbackOnNextSet = false;
        this.failNextReadback = true;
      }
    },
  };
}

async function persistedReady(
  store = secrets(),
  readyCredential = credential(),
) {
  const repo = createSecureTwitchCredentialRepository({ secrets: store, key: `session-${Math.random()}` });
  const id = twitchAttemptId("seed");
  await repo.beginRequest({ attemptId: id, expectedGeneration: twitchCredentialGeneration(0) });
  await repo.beginAttempt({
    expectedGeneration: twitchCredentialGeneration(0),
    attempt: {
      attemptId: id,
      generation: twitchCredentialGeneration(0),
      deviceCode: "seed-secret",
      userCode: "SEED-CODE",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 600_000,
      nextPollAtEpochMs: 5_000,
    },
  });
  await repo.commitConnection({
    attemptId: id,
    expectedGeneration: twitchCredentialGeneration(0),
    credential: readyCredential,
  });
  return { repo, store };
}

async function persistedAttempt(store = secrets()) {
  const repo = createSecureTwitchCredentialRepository({ secrets: store, key: `attempt-${Math.random()}` });
  const id = twitchAttemptId("live-attempt");
  await repo.beginRequest({ attemptId: id, expectedGeneration: twitchCredentialGeneration(0) });
  await repo.beginAttempt({
    expectedGeneration: twitchCredentialGeneration(0),
    attempt: {
      attemptId: id,
      generation: twitchCredentialGeneration(0),
      deviceCode: "device-secret",
      userCode: "LIVE-CODE",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 600_000,
      nextPollAtEpochMs: 5_000,
    },
  });
  return { repo, store };
}

function credential(change: Partial<TwitchCredential> = {}): TwitchCredential {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAtEpochMs: 60_000,
    validatedAtEpochMs: 1_000,
    generation: twitchCredentialGeneration(1),
    scopes: ["chat:read"],
    account: {
      id: twitchAccountId("account-1"),
      login: "streamer",
      displayName: "Streamer",
      profileImageUrl: null,
    },
    ...change,
  };
}

function repository(
  initial: TwitchCredentialSnapshot,
): TwitchCredentialRepository & { state: TwitchCredentialSnapshot } {
  const repo = {
    state: initial,
    read: vi.fn(async () => repo.state),
    beginRequest: vi.fn(async () => true),
    beginAttempt: vi.fn(async () => true),
    clearAttempt: vi.fn(async () => {
      repo.state = { kind: "disconnected", generation: twitchCredentialGeneration(0) };
      return true;
    }),
    claimDevicePoll: vi.fn(async () => ({ kind: "not-due" as const })),
    claimRefresh: vi.fn(async () => ({ kind: "unavailable" as const })),
    commitConnection: vi.fn(async () => true),
    commitRefresh: vi.fn(async () => true),
    commitValidation: vi.fn(async (input) => {
      if (repo.state.kind !== "ready") return false;
      repo.state = {
        kind: "ready",
        credential: {
          ...repo.state.credential,
          scopes: input.scopes,
          expiresAtEpochMs: input.expiresAtEpochMs,
          validatedAtEpochMs: input.validatedAtEpochMs,
        },
      };
      return true;
    }),
    disconnect: vi.fn(async () => true),
    markAuthLost: vi.fn(async (input) => {
      repo.state = {
        kind: "auth-lost",
        account: repo.state.kind === "ready" ? repo.state.credential.account : null,
        generation: twitchCredentialGeneration(input.expectedGeneration + 1),
        reason: input.reason,
      };
      return true;
    }),
    releaseRefreshClaim: vi.fn(async () => true),
  } satisfies TwitchCredentialRepository & { state: TwitchCredentialSnapshot };
  return repo;
}

function gateway(
  overrides: Partial<TwitchDeviceAuthorizationGateway> = {},
): TwitchDeviceAuthorizationGateway {
  const unexpected = async (): Promise<never> => {
    throw new Error("Unexpected Twitch gateway call.");
  };
  return {
    request: unexpected,
    poll: unexpected,
    refresh: unexpected,
    validate: unexpected,
    loadAccount: unexpected,
    ...overrides,
  };
}

function session(input: {
  repo: TwitchCredentialRepository;
  api?: TwitchDeviceAuthorizationGateway | null;
  copy?: (value: string) => Promise<void>;
  now?: () => number;
}) {
  return createTwitchAccountSessionController({
    clientId: input.api === null ? null : "client",
    copy: input.copy ?? vi.fn(async () => undefined),
    gateway: input.api === undefined ? gateway() : input.api,
    now: input.now ?? (() => 10_000),
    open: vi.fn(async () => undefined),
    repository: input.repo,
  });
}

async function foreground(controller: ReturnType<typeof session>) {
  controller.setForeground(true);
  await vi.waitFor(() => expect(controller.getSnapshot().kind).not.toBe("restoring"));
}

describe("Twitch account session controller", () => {
  it("retries reconciliation after a storage read failure instead of starting OAuth", async () => {
    const repo = repository({ kind: "disconnected", generation: twitchCredentialGeneration(0) });
    vi.mocked(repo.read).mockRejectedValueOnce(new Error("locked"));
    const controller = session({ repo, api: null });
    await foreground(controller);
    expect(controller.getSnapshot()).toMatchObject({ kind: "failed", failure: "restore" });
    await controller.retry();
    expect(controller.getSnapshot().kind).toBe("unavailable");
    expect(repo.beginRequest).not.toHaveBeenCalled();
  });

  it("persists authoritative validation metadata and projects missing optional scope as limited", async () => {
    const repo = repository({ kind: "ready", credential: credential() });
    const api = gateway({
      validate: vi.fn(async () => ({
        kind: "valid",
        validation: {
          clientId: "client",
          userId: twitchAccountId("account-1"),
          login: "streamer",
          scopes: [],
          expiresInSeconds: 30,
        },
      })),
    });
    const controller = session({ repo, api });
    await foreground(controller);
    expect(repo.commitValidation).toHaveBeenCalledWith({
      accountId: "account-1",
      expectedGeneration: 1,
      expiresAtEpochMs: 40_000,
      scopes: [],
      validatedAtEpochMs: 10_000,
    });
    expect(controller.getSnapshot()).toMatchObject({
      kind: "connected",
      missingScopes: ["chat:read"],
      scopes: [],
      expiresAtEpochMs: 40_000,
      validatedAtEpochMs: 10_000,
    });
  });

  it.each([
    ["wrong client", "other", twitchAccountId("account-1")],
    ["wrong account", "client", twitchAccountId("account-2")],
  ])("fences %s validation without projecting connected", async (_name, clientId, userId) => {
    const repo = repository({ kind: "ready", credential: credential() });
    const controller = session({
      repo,
      api: gateway({
        validate: vi.fn(async () => ({
          kind: "valid",
          validation: { clientId, userId, login: "streamer", scopes: [], expiresInSeconds: 30 },
        })),
      }),
    });
    await foreground(controller);
    expect(repo.markAuthLost).toHaveBeenCalledWith({ expectedGeneration: 1, reason: "revoked" });
    expect(controller.getSnapshot().kind).not.toBe("connected");
  });

  it("shows an unexpired cached credential as explicitly stale when validation is offline", async () => {
    const repo = repository({ kind: "ready", credential: credential() });
    const controller = session({
      repo,
      api: gateway({ validate: vi.fn(async () => ({ kind: "transient-failure", cause: "offline" })) }),
    });
    await foreground(controller);
    expect(controller.getSnapshot()).toMatchObject({
      kind: "connected",
      notice: expect.stringContaining("last verified"),
    });
  });

  it("uses the durable refresh claim for expired access instead of deleting credentials", async () => {
    const expired = credential({ expiresAtEpochMs: 9_999 });
    const repo = repository({ kind: "ready", credential: expired });
    repo.claimRefresh = vi.fn(async (input) => ({ kind: "claimed", credential: expired, operationId: input.operationId }));
    const api = gateway({ refresh: vi.fn(async () => ({ kind: "not-sent", cause: "offline" })) });
    const controller = session({ repo, api });
    await foreground(controller);
    expect(repo.claimRefresh).toHaveBeenCalled();
    expect(repo.markAuthLost).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ kind: "failed", failure: "restore" });
  });

  it("does not project connected when access expires during slow offline validation", async () => {
    let now = 10_000;
    let resolveValidation!: (value: Awaited<ReturnType<TwitchDeviceAuthorizationGateway["validate"]>>) => void;
    const current = credential({ expiresAtEpochMs: 11_000 });
    const repo = repository({ kind: "ready", credential: current });
    repo.claimRefresh = vi.fn(async (input) => ({ kind: "claimed", credential: current, operationId: input.operationId }));
    const controller = session({
      repo,
      now: () => now,
      api: gateway({
        validate: vi.fn(() => new Promise((resolve) => (resolveValidation = resolve))),
        refresh: vi.fn(async () => ({ kind: "not-sent", cause: "offline" })),
      }),
    });
    controller.setForeground(true);
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("validating"));
    now = 12_000;
    resolveValidation({ kind: "transient-failure", cause: "offline" });
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("failed"));
    expect(controller.getSnapshot().kind).not.toBe("connected");
  });

  it("routes auth-lost Retry to a new Device Code request", async () => {
    const repo = repository({
      kind: "auth-lost",
      account: credential().account,
      generation: twitchCredentialGeneration(2),
      reason: "revoked",
    });
    const api = gateway({
      request: vi.fn(async () => ({
        deviceCode: "secret",
        userCode: "AAAA-BBBB",
        verificationUri: "https://www.twitch.tv/activate",
        expiresInSeconds: 600,
        intervalSeconds: 5,
      })),
    });
    const controller = session({ repo, api });
    await foreground(controller);
    await controller.retry();
    expect(repo.beginRequest).toHaveBeenCalled();
    expect(api.request).toHaveBeenCalledOnce();
  });

  it("suppresses duplicate refresh and treats a thrown post-claim response as uncertain", async () => {
    const { repo } = await persistedReady();
    let rejectRefresh!: (reason: unknown) => void;
    const refresh = vi.fn(() => new Promise<never>((_resolve, reject) => (rejectRefresh = reject)));
    const api = gateway({
      validate: vi.fn(async () => ({
        kind: "valid",
        validation: {
          clientId: "client",
          userId: twitchAccountId("account-1"),
          login: "streamer",
          scopes: ["chat:read"],
          expiresInSeconds: 30,
        },
      })),
      refresh,
    });
    const controller = session({ repo, api });
    await foreground(controller);
    const first = controller.refresh();
    const second = controller.refresh();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    rejectRefresh(new Error("offline"));
    await Promise.all([first, second]);
    expect(controller.getSnapshot()).toMatchObject({
      kind: "auth-lost",
      reason: "refresh-outcome-unknown",
    });
  });

  it("preserves ready state only for a typed pre-send refresh failure", async () => {
    const { repo } = await persistedReady();
    const api = gateway({
      validate: vi.fn(async () => ({
        kind: "valid",
        validation: {
          clientId: "client",
          userId: twitchAccountId("account-1"),
          login: "streamer",
          scopes: ["chat:read"],
          expiresInSeconds: 30,
        },
      })),
      refresh: vi.fn(async () => ({ kind: "not-sent", cause: "offline" })),
    });
    const controller = session({ repo, api });
    await foreground(controller);
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      kind: "connected",
      notice: expect.stringContaining("temporarily unavailable"),
    });
    await expect(repo.read()).resolves.toMatchObject({ kind: "ready" });
  });

  it("reconciles durable disconnected state after a readback verification error", async () => {
    const prepared = await persistedReady();
    const controller = session({
      repo: prepared.repo,
      api: gateway({
        validate: vi.fn(async () => ({
          kind: "valid",
          validation: {
            clientId: "client",
            userId: twitchAccountId("account-1"),
            login: "streamer",
            scopes: ["chat:read"],
            expiresInSeconds: 30,
          },
        })),
      }),
    });
    await foreground(controller);
    await controller.disconnect();
    prepared.store.failReadbackOnNextSet = true;
    await controller.disconnect();
    expect(controller.getSnapshot().kind).toBe("disconnected");
  });

  it("schedules revalidation at credential expiry when it is sooner than one hour", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const repo = repository({ kind: "ready", credential: credential() });
    const controller = session({
      repo,
      api: gateway({
        validate: vi.fn(async () => ({
          kind: "transient-failure",
          cause: "offline",
        })),
      }),
    });
    await foreground(controller);
    expect(timeout.mock.calls.some((call) => call[1] === 50_000)).toBe(true);
    timeout.mockRestore();
  });

  it("accepts the same-millisecond validated record that won the durable fence", async () => {
    const { repo } = await persistedReady();
    const validate = vi.fn(async () => ({
      kind: "valid" as const,
      validation: {
        clientId: "client",
        userId: twitchAccountId("account-1"),
        login: "streamer",
        scopes: ["chat:read"],
        expiresInSeconds: 30,
      },
    }));
    const controller = session({ repo, api: gateway({ validate }) });
    await foreground(controller);
    controller.setForeground(false);
    controller.setForeground(true);
    await vi.waitFor(() => expect(validate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("connected"));
  });

  it("does not restore connected after slow typed not-sent refresh crosses expiry", async () => {
    let now = 10_000;
    const prepared = await persistedReady(secrets(), credential({ expiresAtEpochMs: 11_000 }));
    let finishRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<TwitchDeviceAuthorizationGateway["refresh"]>>>((resolve) =>
          (finishRefresh = () => resolve({ kind: "not-sent", cause: "offline" })),
        ),
    );
    const controller = session({
      repo: prepared.repo,
      now: () => now,
      api: gateway({
        validate: vi.fn(async () => ({ kind: "transient-failure", cause: "offline" })),
        refresh,
      }),
    });
    await foreground(controller);
    const refreshing = controller.refresh();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    now = 12_000;
    finishRefresh();
    await refreshing;
    expect(controller.getSnapshot()).toMatchObject({ kind: "failed", failure: "restore" });
    await expect(prepared.repo.read()).resolves.toMatchObject({ kind: "ready" });
  });

  it("treats same-identity zero validation lifetime as refreshable access expiry", async () => {
    const prepared = await persistedReady();
    const controller = session({
      repo: prepared.repo,
      api: gateway({
        validate: vi.fn(async () => ({
          kind: "valid",
          validation: {
            clientId: "client",
            userId: twitchAccountId("account-1"),
            login: "streamer",
            scopes: ["chat:read"],
            expiresInSeconds: 0,
          },
        })),
        refresh: vi.fn(async () => ({ kind: "not-sent", cause: "offline" })),
      }),
    });
    await foreground(controller);
    expect(controller.getSnapshot()).toMatchObject({ kind: "failed", failure: "restore" });
    expect((await prepared.repo.read()).kind).toBe("ready");
  });

  it("reconciles ready after commitConnection writes but readback verification fails", async () => {
    const prepared = await persistedAttempt();
    const poll = vi.fn(async () => ({
      kind: "authorized" as const,
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresInSeconds: 60,
      scopes: ["chat:read"],
    }));
    const validate = vi.fn(async () => ({
      kind: "valid" as const,
      validation: {
        clientId: "client",
        userId: twitchAccountId("account-1"),
        login: "streamer",
        scopes: ["chat:read"],
        expiresInSeconds: 60,
      },
    }));
    const controller = session({
      repo: prepared.repo,
      api: gateway({
        poll,
        validate,
        loadAccount: vi.fn(async () => {
          prepared.store.failReadbackOnNextSet = true;
          return { kind: "found", account: credential().account };
        }),
      }),
    });
    await foreground(controller);
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("connected"));
    expect(poll).toHaveBeenCalledOnce();
    await expect(prepared.repo.read()).resolves.toMatchObject({ kind: "ready" });
  });

  it("clears a consumed Device Code after post-authorization validation throws without hot-looping", async () => {
    const prepared = await persistedAttempt();
    const poll = vi.fn(async () => ({
      kind: "authorized" as const,
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresInSeconds: 60,
      scopes: ["chat:read"],
    }));
    const controller = session({
      repo: prepared.repo,
      api: gateway({
        poll,
        validate: vi.fn(async () => Promise.reject(new Error("response lost"))),
      }),
    });
    await foreground(controller);
    await vi.waitFor(() =>
      expect(controller.getSnapshot()).toMatchObject({ kind: "failed", failure: "connection" }),
    );
    expect(poll).toHaveBeenCalledOnce();
    await expect(prepared.repo.read()).resolves.toMatchObject({ kind: "disconnected" });
  });

  it("drops delayed Copy completion after background invalidates the attempt lease", async () => {
    let finish!: () => void;
    const copy = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const attempt = {
      attemptId: twitchAttemptId("attempt-a"),
      generation: twitchCredentialGeneration(0),
      deviceCode: "secret",
      userCode: "AAAA-BBBB",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 60_000,
      nextPollAtEpochMs: 50_000,
    };
    const repo = repository({ kind: "connecting", attempt });
    const controller = session({ repo, copy });
    await foreground(controller);
    const pending = controller.getSnapshot();
    const copying = controller.copyCode();
    controller.setForeground(false);
    finish();
    await copying;
    expect(controller.getSnapshot()).toEqual(pending);
  });

  it("retains Copy feedback when the same attempt receives another pending poll", async () => {
    const attempt = {
      attemptId: twitchAttemptId("attempt-a"),
      generation: twitchCredentialGeneration(0),
      deviceCode: "secret",
      userCode: "AAAA-BBBB",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 60_000,
      nextPollAtEpochMs: 20,
    };
    const repo = repository({ kind: "connecting", attempt });
    vi.mocked(repo.claimDevicePoll).mockResolvedValue({
      kind: "claimed",
      attempt,
    });
    const poll = vi.fn(async () => {
      return { kind: "pending" as const };
    });
    const controller = session({ repo, now: () => 0, api: gateway({ poll }) });
    vi.useFakeTimers();
    try {
      controller.setForeground(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.getSnapshot().kind).toBe("pending");
      await controller.copyCode();
      expect(controller.getSnapshot()).toMatchObject({
        kind: "pending",
        feedback: "Code copied.",
      });

      await vi.advanceTimersByTimeAsync(20);
      expect(poll).toHaveBeenCalledOnce();
      expect(controller.getSnapshot()).toMatchObject({
        kind: "pending",
        feedback: "Code copied.",
      });
    } finally {
      controller.setForeground(false);
      vi.useRealTimers();
    }
  });

  it("retains Copy feedback when the same attempt returns to offline pending", async () => {
    const attempt = {
      attemptId: twitchAttemptId("attempt-a"),
      generation: twitchCredentialGeneration(0),
      deviceCode: "secret",
      userCode: "AAAA-BBBB",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 60_000,
      nextPollAtEpochMs: 20,
    };
    const repo = repository({ kind: "connecting", attempt });
    vi.mocked(repo.claimDevicePoll).mockResolvedValue({
      kind: "claimed",
      attempt,
    });
    const poll = vi.fn(async () => {
      throw new Error("offline");
    });
    const controller = session({ repo, now: () => 0, api: gateway({ poll }) });
    vi.useFakeTimers();
    try {
      controller.setForeground(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.getSnapshot().kind).toBe("pending");
      await controller.copyCode();
      await vi.advanceTimersByTimeAsync(20);
      expect(poll).toHaveBeenCalledOnce();
      expect(controller.getSnapshot()).toMatchObject({
        kind: "pending",
        status: "offline",
        feedback: "Code copied.",
      });
    } finally {
      controller.setForeground(false);
      vi.useRealTimers();
    }
  });

  it("replaces failed Copy feedback with success and clears it for a new attempt", async () => {
    const attempt = {
      attemptId: twitchAttemptId("attempt-a"),
      generation: twitchCredentialGeneration(0),
      deviceCode: "secret",
      userCode: "AAAA-BBBB",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 60_000,
      nextPollAtEpochMs: 50_000,
    };
    const repo = repository({ kind: "connecting", attempt });
    const copy = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("clipboard unavailable"))
      .mockResolvedValue(undefined);
    const request = vi.fn(
      () => new Promise<never>(() => undefined),
    );
    const controller = session({ repo, copy, api: gateway({ request }) });
    await foreground(controller);

    await controller.copyCode();
    expect(controller.getSnapshot()).toMatchObject({
      kind: "pending",
      feedback: "Code could not be copied.",
    });
    await controller.copyCode();
    expect(controller.getSnapshot()).toMatchObject({
      kind: "pending",
      feedback: "Code copied.",
    });

    await controller.cancel();
    expect(controller.getSnapshot().kind).toBe("disconnected");
    void controller.connect();
    expect(controller.getSnapshot()).toEqual({ kind: "requesting" });
    controller.setForeground(false);
  });

  it("clears Copy feedback when the attempt reaches a terminal result", async () => {
    const attempt = {
      attemptId: twitchAttemptId("attempt-a"),
      generation: twitchCredentialGeneration(0),
      deviceCode: "secret",
      userCode: "AAAA-BBBB",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 60_000,
      nextPollAtEpochMs: 20,
    };
    const repo = repository({ kind: "connecting", attempt });
    vi.mocked(repo.claimDevicePoll).mockResolvedValue({
      kind: "claimed",
      attempt,
    });
    const poll = vi.fn(async () => {
      return { kind: "denied" as const };
    });
    const controller = session({
      repo,
      now: () => 0,
      api: gateway({ poll }),
    });
    vi.useFakeTimers();
    try {
      controller.setForeground(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.getSnapshot().kind).toBe("pending");
      await controller.copyCode();
      await vi.advanceTimersByTimeAsync(20);
      expect(poll).toHaveBeenCalledOnce();
      expect(controller.getSnapshot()).toMatchObject({
        kind: "failed",
        failure: "connection",
      });
      expect("feedback" in controller.getSnapshot()).toBe(false);
    } finally {
      controller.setForeground(false);
      vi.useRealTimers();
    }
  });

  it("cancels the captured attempt directly and never rediscovers a newer target", async () => {
    const attempt = {
      attemptId: twitchAttemptId("attempt-a"),
      generation: twitchCredentialGeneration(0),
      deviceCode: "secret",
      userCode: "AAAA-BBBB",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 600,
      intervalSeconds: 5,
      expiresAtEpochMs: 60_000,
      nextPollAtEpochMs: 50_000,
    };
    const repo = repository({ kind: "connecting", attempt });
    const controller = session({ repo });
    await foreground(controller);
    await controller.cancel();
    expect(repo.clearAttempt).toHaveBeenCalledWith("attempt-a");
    expect(vi.mocked(repo.clearAttempt).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(repo.read).mock.invocationCallOrder[1] ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
