import { describe, expect, it, vi } from "vitest";

import {
  twitchAccountId,
  twitchCredentialGeneration,
  type TwitchCredentialRepository,
  type TwitchDeviceAuthorizationGateway,
} from "@streamfusion/core/auth";
import {
  recoverInterruptedTwitchRefresh,
  refreshTwitchCredential,
} from "@mobile/features/auth/domain/twitch-refresh-coordinator";

const cancellation = { aborted: false, onCancel: () => () => undefined };
const credential = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAtEpochMs: 1,
  validatedAtEpochMs: 1,
  generation: twitchCredentialGeneration(1),
  scopes: ["chat:read"],
  account: {
    id: twitchAccountId("u1"),
    login: "user",
    displayName: "User",
    profileImageUrl: null,
  },
};

function repository(): TwitchCredentialRepository {
  return {
    read: vi.fn(),
    beginRequest: vi.fn(),
    beginAttempt: vi.fn(),
    clearAttempt: vi.fn(),
    claimDevicePoll: vi.fn(),
    claimRefresh: vi.fn(async () => ({
      kind: "claimed",
      credential,
      operationId: "op",
    })),
    commitConnection: vi.fn(),
    commitRefresh: vi.fn(async () => true),
    disconnect: vi.fn(),
    markAuthLost: vi.fn(async () => true),
    releaseRefreshClaim: vi.fn(async () => true),
  };
}

function gateway(
  refresh: TwitchDeviceAuthorizationGateway["refresh"],
): TwitchDeviceAuthorizationGateway {
  return {
    refresh,
    loadAccount: vi.fn(),
    poll: vi.fn(),
    request: vi.fn(),
    validate: vi.fn(async () => ({
      kind: "valid",
      validation: {
        clientId: "public-client",
        userId: twitchAccountId("u1"),
        login: "user",
        scopes: ["chat:read"],
        expiresInSeconds: 90,
      },
    })),
  };
}

describe("one-time Twitch refresh coordination", () => {
  it("atomically commits the rotated token at the next generation", async () => {
    const store = repository();
    const result = await refreshTwitchCredential({
      repository: store,
      gateway: gateway(async () => ({
        kind: "refreshed",
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresInSeconds: 100,
        scopes: ["chat:read"],
      })),
      expectedGeneration: twitchCredentialGeneration(1),
      expectedClientId: "public-client",
      operationId: "op",
      nowEpochMs: () => 7_000,
      signal: cancellation,
    });
    expect(result).toMatchObject({
      kind: "refreshed",
      credential: {
        refreshToken: "refresh-2",
        generation: 2,
        validatedAtEpochMs: 7_000,
        expiresAtEpochMs: 97_000,
      },
    });
    expect(store.commitRefresh).toHaveBeenCalledOnce();
  });

  it("turns an uncertain dispatch into auth loss without releasing the claim", async () => {
    const store = repository();
    await expect(
      refreshTwitchCredential({
        repository: store,
        gateway: gateway(async () => ({
          kind: "outcome-unknown",
          cause: new Error("timeout"),
        })),
        expectedGeneration: twitchCredentialGeneration(1),
        expectedClientId: "public-client",
        operationId: "op",
        nowEpochMs: () => 5_000,
        signal: cancellation,
      }),
    ).resolves.toEqual({
      kind: "auth-lost",
      reason: "refresh-outcome-unknown",
    });
    expect(store.markAuthLost).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "refresh-outcome-unknown" }),
    );
    expect(store.releaseRefreshClaim).not.toHaveBeenCalled();
  });

  it("refuses to reuse a durable refresh claim after restart", async () => {
    const store = repository();
    store.read = vi.fn(async () => ({
      kind: "refresh-in-flight",
      account: credential.account,
      credential,
      operationId: "op",
    }));
    await expect(recoverInterruptedTwitchRefresh(store)).resolves.toBe(
      "recovered",
    );
    expect(store.markAuthLost).toHaveBeenCalledWith({
      expectedGeneration: 1,
      operationId: "op",
      reason: "refresh-outcome-unknown",
    });
  });

  it("reports stale when a disconnect wins the tombstone fence", async () => {
    const store = repository();
    store.markAuthLost = vi.fn(async () => false);
    await expect(
      refreshTwitchCredential({
        repository: store,
        gateway: gateway(async () => ({
          kind: "outcome-unknown",
          cause: new Error("timeout"),
        })),
        expectedGeneration: twitchCredentialGeneration(1),
        expectedClientId: "public-client",
        operationId: "op",
        nowEpochMs: () => 5_000,
        signal: cancellation,
      }),
    ).resolves.toEqual({ kind: "stale" });
  });
});
