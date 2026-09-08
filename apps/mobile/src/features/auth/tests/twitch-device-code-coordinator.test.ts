import { describe, expect, it, vi } from "vitest";

import {
  twitchAccountId,
  twitchAttemptId,
  twitchCredentialGeneration,
  type TwitchDeviceAuthorizationGateway,
} from "@streamfusion/core/auth";

import { createSecureTwitchCredentialRepository } from "@mobile/features/auth/data/secure-twitch-credential-repository";
import {
  pollTwitchDeviceCode,
  startTwitchDeviceCode,
} from "@mobile/features/auth/domain/twitch-device-code-coordinator";
import type { SecureSecretStore } from "@mobile/features/storage/capabilities/persistence";

const cancellation = { aborted: false, onCancel: () => () => undefined };

function secrets(): SecureSecretStore {
  const values = new Map<string, string>();
  return {
    delete: async (key) => void values.delete(key),
    get: async (key) => values.get(key) ?? null,
    isAvailable: async () => true,
    set: async (key, value) => void values.set(key, value),
  };
}

function gateway(): TwitchDeviceAuthorizationGateway {
  return {
    request: vi.fn(async () => ({
      deviceCode: "secret-code",
      userCode: "ABCDEFGH",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 300,
      intervalSeconds: 5,
    })),
    poll: vi.fn(async () => ({ kind: "pending" })),
    validate: vi.fn(async () => ({
      kind: "valid",
      validation: {
        clientId: "public-client",
        userId: twitchAccountId("u1"),
        login: "user",
        scopes: ["chat:read"],
        expiresInSeconds: 100,
      },
    })),
    loadAccount: vi.fn(async () => ({
      kind: "found",
      account: {
        id: twitchAccountId("u1"),
        login: "user",
        displayName: "User",
        profileImageUrl: null,
      },
    })),
    refresh: vi.fn(),
  };
}

describe("Twitch Device Code coordination", () => {
  it("persists the secret attempt but exposes only its safe projection", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "test",
    });
    const result = await startTwitchDeviceCode({
      repository,
      gateway: gateway(),
      attemptId: twitchAttemptId("attempt-1"),
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: ["chat:read"],
      nowEpochMs: () => 1_000,
      signal: cancellation,
    });
    expect(result).toMatchObject({
      kind: "pending",
      attempt: { userCode: "ABCDEFGH", nextPollAtEpochMs: 6_000 },
    });
    expect(JSON.stringify(result)).not.toContain("secret-code");
    await expect(repository.read()).resolves.toMatchObject({
      kind: "connecting",
      attempt: { deviceCode: "secret-code" },
    });
  });

  it("anchors first polling cadence after a delayed Device Code response", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "delayed-code",
    });
    const clock = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValue(4_000);
    await expect(
      startTwitchDeviceCode({
        repository,
        gateway: gateway(),
        attemptId: twitchAttemptId("attempt-1"),
        expectedGeneration: twitchCredentialGeneration(0),
        scopes: [],
        nowEpochMs: clock,
        signal: cancellation,
      }),
    ).resolves.toMatchObject({
      kind: "pending",
      attempt: {
        expiresAtEpochMs: 301_000,
        nextPollAtEpochMs: 9_000,
      },
    });
  });

  it("paces pending polls and commits a validated limited account", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "test",
    });
    const api = gateway();
    const attemptId = twitchAttemptId("attempt-1");
    await startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: ["chat:read", "chat:edit"],
      nowEpochMs: () => 1_000,
      signal: cancellation,
    });
    await expect(
      pollTwitchDeviceCode({
        repository,
        gateway: api,
        attemptId,
        expectedClientId: "public-client",
        requiredScopes: ["chat:read", "chat:edit"],
        nowEpochMs: () => 5_999,
        signal: cancellation,
      }),
    ).resolves.toEqual({
      kind: "pending",
      nextPollAtEpochMs: 6_000,
      status: "waiting",
    });
    expect(api.poll).not.toHaveBeenCalled();
    api.poll = vi.fn(async () => ({
      kind: "authorized",
      accessToken: "access",
      refreshToken: "refresh",
      expiresInSeconds: 100,
      scopes: ["ignored"],
    }));
    const clock = vi
      .fn<() => number>()
      .mockReturnValueOnce(6_000)
      .mockReturnValueOnce(6_000)
      .mockReturnValueOnce(7_000)
      .mockReturnValue(9_000);
    await expect(
      pollTwitchDeviceCode({
        repository,
        gateway: api,
        attemptId,
        expectedClientId: "public-client",
        requiredScopes: ["chat:read", "chat:edit"],
        nowEpochMs: clock,
        signal: cancellation,
      }),
    ).resolves.toEqual({ kind: "connected", missingScopes: ["chat:edit"] });
    await expect(repository.read()).resolves.toMatchObject({
      kind: "ready",
      credential: {
        accessToken: "access",
        validatedAtEpochMs: 7_000,
        expiresAtEpochMs: 107_000,
        scopes: ["chat:read"],
      },
    });
  });

  it("prevents a superseded attempt from committing", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "test",
    });
    const api = gateway();
    await startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId: twitchAttemptId("old"),
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 0,
      signal: cancellation,
    });
    await startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId: twitchAttemptId("new"),
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 1,
      signal: cancellation,
    });
    await expect(
      pollTwitchDeviceCode({
        repository,
        gateway: api,
        attemptId: twitchAttemptId("old"),
        expectedClientId: "public-client",
        requiredScopes: [],
        nowEpochMs: () => 5_000,
        signal: cancellation,
      }),
    ).resolves.toEqual({ kind: "stale" });
  });

  it("prevents an older request response from replacing a newer attempt", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "request-race",
    });
    const resolvers: ((
      value: Awaited<ReturnType<TwitchDeviceAuthorizationGateway["request"]>>,
    ) => void)[] = [];
    const api = gateway();
    api.request = vi.fn(
      async () => await new Promise((resolve) => resolvers.push(resolve)),
    );
    const old = startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId: twitchAttemptId("old"),
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 0,
      signal: cancellation,
    });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    const newer = startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId: twitchAttemptId("new"),
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 1,
      signal: cancellation,
    });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    const authorization = {
      deviceCode: "new-secret",
      userCode: "NEWCODE",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 300,
      intervalSeconds: 5,
    };
    resolvers[1]?.(authorization);
    await expect(newer).resolves.toMatchObject({
      kind: "pending",
      attempt: { attemptId: "new" },
    });
    resolvers[0]?.({
      ...authorization,
      deviceCode: "old-secret",
      userCode: "OLDCODE",
    });
    await expect(old).resolves.toEqual({ kind: "stale" });
    await expect(repository.read()).resolves.toMatchObject({
      kind: "connecting",
      attempt: { attemptId: "new", deviceCode: "new-secret" },
    });
  });

  it("reserves the next poll before dispatch so duplicate callers do not poll", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "poll-race",
    });
    const api = gateway();
    let resolvePoll:
      ((value: { readonly kind: "pending" }) => void) | undefined;
    api.poll = vi.fn(
      async () => await new Promise((resolve) => (resolvePoll = resolve)),
    );
    let nowEpochMs = 5_000;
    const attemptId = twitchAttemptId("attempt-1");
    await startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 0,
      signal: cancellation,
    });
    const first = pollTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedClientId: "public-client",
      requiredScopes: [],
      nowEpochMs: () => nowEpochMs,
      signal: cancellation,
    });
    await vi.waitFor(() => expect(api.poll).toHaveBeenCalledOnce());
    nowEpochMs = 10_000;
    const second = pollTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedClientId: "public-client",
      requiredScopes: [],
      nowEpochMs: () => nowEpochMs,
      signal: cancellation,
    });
    await expect(second).resolves.toEqual({
      kind: "pending",
      nextPollAtEpochMs: 10_000,
      status: "waiting",
    });
    nowEpochMs = 12_000;
    resolvePoll?.({ kind: "pending" });
    await expect(first).resolves.toEqual({
      kind: "pending",
      nextPollAtEpochMs: 17_000,
      status: "waiting",
    });
    await expect(repository.read()).resolves.toMatchObject({
      kind: "connecting",
      attempt: { nextPollAtEpochMs: 17_000 },
    });
    expect(api.poll).toHaveBeenCalledOnce();
  });

  it("releases a failed poll with provider cadence from completion", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "poll-failure",
    });
    const api = gateway();
    api.poll = vi.fn(async () => {
      throw new Error("offline");
    });
    const attemptId = twitchAttemptId("attempt-1");
    await startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 0,
      signal: cancellation,
    });
    await expect(
      pollTwitchDeviceCode({
        repository,
        gateway: api,
        attemptId,
        expectedClientId: "public-client",
        requiredScopes: [],
        nowEpochMs: () => 12_000,
        signal: cancellation,
      }),
    ).rejects.toThrow("offline");
    await expect(repository.read()).resolves.toMatchObject({
      kind: "connecting",
      attempt: { nextPollAtEpochMs: 17_000 },
    });
  });

  it("increases cadence for repeated slowdown and connection timeout", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "backoff",
    });
    const api = gateway();
    const attemptId = twitchAttemptId("attempt-1");
    await startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 0,
      signal: cancellation,
    });
    api.poll = vi
      .fn()
      .mockResolvedValueOnce({ kind: "slow-down", retryAfterSeconds: null })
      .mockResolvedValueOnce({ kind: "slow-down", retryAfterSeconds: null })
      .mockResolvedValueOnce({ kind: "transient-failure" });
    await pollTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedClientId: "public-client",
      requiredScopes: [],
      nowEpochMs: () => 5_000,
      signal: cancellation,
    });
    await pollTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedClientId: "public-client",
      requiredScopes: [],
      nowEpochMs: () => 15_000,
      signal: cancellation,
    });
    await pollTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedClientId: "public-client",
      requiredScopes: [],
      nowEpochMs: () => 30_000,
      signal: cancellation,
    });
    await expect(repository.read()).resolves.toMatchObject({
      kind: "connecting",
      attempt: { intervalSeconds: 30, nextPollAtEpochMs: 60_000 },
    });
  });

  it("contains account lookup failure without leaving a poll claim", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: secrets(),
      key: "lookup-failure",
    });
    const api = gateway();
    api.poll = vi.fn(async () => ({
      kind: "authorized",
      accessToken: "access",
      refreshToken: "refresh",
      expiresInSeconds: 100,
      scopes: [],
    }));
    api.loadAccount = vi.fn(async () => ({
      kind: "transient-failure",
      cause: new Error("offline"),
    }));
    const attemptId = twitchAttemptId("attempt-1");
    await startTwitchDeviceCode({
      repository,
      gateway: api,
      attemptId,
      expectedGeneration: twitchCredentialGeneration(0),
      scopes: [],
      nowEpochMs: () => 0,
      signal: cancellation,
    });
    await expect(
      pollTwitchDeviceCode({
        repository,
        gateway: api,
        attemptId,
        expectedClientId: "public-client",
        requiredScopes: [],
        nowEpochMs: () => 5_000,
        signal: cancellation,
      }),
    ).resolves.toEqual({ kind: "reconnect-required" });
    await expect(repository.read()).resolves.toMatchObject({
      kind: "auth-lost",
      reason: "connection-validation-failed",
    });
  });
});
