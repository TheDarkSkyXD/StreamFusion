import { describe, expect, it } from "vitest";

import {
  twitchAccountId,
  twitchAttemptId,
  twitchCredentialGeneration,
  type TwitchCredential,
} from "@streamfusion/core/auth";

import type { SecureSecretStore } from "@mobile/features/storage/capabilities/persistence";
import { createSecureTwitchCredentialRepository } from "@mobile/features/auth/data/secure-twitch-credential-repository";

function credential(
  generation: number,
  refreshToken = `refresh-${generation}`,
): TwitchCredential {
  return {
    accessToken: `access-${generation}`,
    refreshToken,
    expiresAtEpochMs: 10_000,
    validatedAtEpochMs: 1_000,
    generation: twitchCredentialGeneration(generation),
    scopes: ["chat:read"],
    account: {
      id: twitchAccountId("account-1"),
      login: "streamer",
      displayName: "Streamer",
      profileImageUrl: null,
    },
  };
}

function memorySecrets(): SecureSecretStore & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    delete: async (key) => void values.delete(key),
    get: async (key) => values.get(key) ?? null,
    isAvailable: async () => true,
    set: async (key, value) => void values.set(key, value),
  };
}

async function begin(
  repository: ReturnType<typeof createSecureTwitchCredentialRepository>,
) {
  await repository.beginRequest({
    attemptId: twitchAttemptId("attempt-1"),
    expectedGeneration: twitchCredentialGeneration(0),
  });
  await repository.beginAttempt({
    expectedGeneration: twitchCredentialGeneration(0),
    attempt: {
      attemptId: twitchAttemptId("attempt-1"),
      deviceCode: "secret-device-code",
      userCode: "ABCDEFGH",
      verificationUri: "https://www.twitch.tv/activate",
      expiresInSeconds: 300,
      intervalSeconds: 5,
      expiresAtEpochMs: 300_000,
      nextPollAtEpochMs: 5_000,
      generation: twitchCredentialGeneration(0),
    },
  });
}

describe("SecureStore Twitch credential envelope", () => {
  it("commits all credential fields together and rejects a stale generation", async () => {
    const secrets = memorySecrets();
    const repository = createSecureTwitchCredentialRepository({
      secrets,
      key: "test",
    });
    await begin(repository);
    await expect(
      repository.commitConnection({
        attemptId: twitchAttemptId("attempt-1"),
        credential: credential(1),
        expectedGeneration: twitchCredentialGeneration(0),
      }),
    ).resolves.toBe(true);
    await expect(
      repository.commitConnection({
        attemptId: twitchAttemptId("attempt-1"),
        credential: credential(2),
        expectedGeneration: twitchCredentialGeneration(0),
      }),
    ).resolves.toBe(false);
    await expect(repository.read()).resolves.toEqual({
      kind: "ready",
      credential: credential(1),
    });
    expect(secrets.values.get("test")).toContain('"refreshToken":"refresh-1"');
  });

  it("persists the refresh claim before replacing a one-time token", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: memorySecrets(),
      key: "test",
    });
    await begin(repository);
    await repository.commitConnection({
      attemptId: twitchAttemptId("attempt-1"),
      credential: credential(1),
      expectedGeneration: twitchCredentialGeneration(0),
    });
    await expect(
      repository.claimRefresh({
        expectedGeneration: twitchCredentialGeneration(1),
        operationId: "refresh-op",
      }),
    ).resolves.toMatchObject({ kind: "claimed", operationId: "refresh-op" });
    await expect(
      repository.commitRefresh({
        credential: credential(2),
        expectedGeneration: twitchCredentialGeneration(1),
        operationId: "wrong-op",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.commitRefresh({
        credential: credential(2),
        expectedGeneration: twitchCredentialGeneration(1),
        operationId: "refresh-op",
      }),
    ).resolves.toBe(true);
    await expect(repository.read()).resolves.toEqual({
      kind: "ready",
      credential: credential(2),
    });
  });

  it("fences validation metadata by generation and account identity", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: memorySecrets(),
      key: "validated",
    });
    await begin(repository);
    await repository.commitConnection({
      attemptId: twitchAttemptId("attempt-1"),
      credential: credential(1),
      expectedGeneration: twitchCredentialGeneration(0),
    });
    await expect(
      repository.commitValidation({
        accountId: twitchAccountId("wrong"),
        expectedGeneration: twitchCredentialGeneration(1),
        scopes: [],
        expiresAtEpochMs: 20_000,
        validatedAtEpochMs: 2_000,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.commitValidation({
        accountId: twitchAccountId("account-1"),
        expectedGeneration: twitchCredentialGeneration(1),
        scopes: [],
        expiresAtEpochMs: 15_000,
        validatedAtEpochMs: 500,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.commitValidation({
        accountId: twitchAccountId("account-1"),
        expectedGeneration: twitchCredentialGeneration(1),
        scopes: ["user:read:email"],
        expiresAtEpochMs: 20_000,
        validatedAtEpochMs: 2_000,
      }),
    ).resolves.toBe(true);
    await expect(repository.read()).resolves.toMatchObject({
      kind: "ready",
      credential: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        scopes: ["user:read:email"],
        expiresAtEpochMs: 20_000,
        validatedAtEpochMs: 2_000,
      },
    });
  });

  it("fences an uncertain refresh and preserves only account-safe identity", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: memorySecrets(),
      key: "test",
    });
    await begin(repository);
    await repository.commitConnection({
      attemptId: twitchAttemptId("attempt-1"),
      credential: credential(1),
      expectedGeneration: twitchCredentialGeneration(0),
    });
    await repository.claimRefresh({
      expectedGeneration: twitchCredentialGeneration(1),
      operationId: "refresh-op",
    });
    await repository.markAuthLost({
      expectedGeneration: twitchCredentialGeneration(1),
      operationId: "refresh-op",
      reason: "refresh-outcome-unknown",
    });
    const state = await repository.read();
    expect(state).toMatchObject({
      kind: "auth-lost",
      generation: 2,
      reason: "refresh-outcome-unknown",
      account: { id: "account-1" },
    });
    expect(JSON.stringify(state)).not.toContain("access-1");
    expect(JSON.stringify(state)).not.toContain("refresh-1");
  });

  it("disconnect invalidates an in-flight refresh without touching other stores", async () => {
    const repository = createSecureTwitchCredentialRepository({
      secrets: memorySecrets(),
      key: "test",
    });
    await begin(repository);
    await repository.commitConnection({
      attemptId: twitchAttemptId("attempt-1"),
      credential: credential(1),
      expectedGeneration: twitchCredentialGeneration(0),
    });
    await repository.claimRefresh({
      expectedGeneration: twitchCredentialGeneration(1),
      operationId: "refresh-op",
    });
    await expect(
      repository.disconnect(twitchCredentialGeneration(1)),
    ).resolves.toBe(true);
    await expect(
      repository.commitRefresh({
        credential: credential(2),
        expectedGeneration: twitchCredentialGeneration(1),
        operationId: "refresh-op",
      }),
    ).resolves.toBe(false);
    await expect(repository.read()).resolves.toEqual({
      kind: "disconnected",
      generation: 2,
    });
  });

  it("shares one writer queue across repository instances and persists attempts", async () => {
    const secrets = memorySecrets();
    const first = createSecureTwitchCredentialRepository({
      secrets,
      key: "test",
    });
    const second = createSecureTwitchCredentialRepository({
      secrets,
      key: "test",
    });
    await begin(first);
    await expect(second.read()).resolves.toMatchObject({
      kind: "connecting",
      attempt: { attemptId: "attempt-1", deviceCode: "secret-device-code" },
    });
    await first.commitConnection({
      attemptId: twitchAttemptId("attempt-1"),
      credential: credential(1),
      expectedGeneration: twitchCredentialGeneration(0),
    });
    const claim = first.claimRefresh({
      expectedGeneration: twitchCredentialGeneration(1),
      operationId: "refresh-op",
    });
    const disconnect = second.disconnect(twitchCredentialGeneration(1));
    await expect(claim).resolves.toMatchObject({ kind: "claimed" });
    await expect(disconnect).resolves.toBe(true);
    await expect(
      first.commitRefresh({
        credential: credential(2),
        expectedGeneration: twitchCredentialGeneration(1),
        operationId: "refresh-op",
      }),
    ).resolves.toBe(false);
    await expect(first.read()).resolves.toEqual({
      kind: "disconnected",
      generation: 2,
    });
  });

  it.each([
    ["empty token", { accessToken: "" }],
    ["infinite expiry", { expiresAtEpochMs: Number.POSITIVE_INFINITY }],
    ["negative validation time", { validatedAtEpochMs: -1 }],
    ["fractional generation", { generation: 1.5 }],
  ])("rejects restored credentials with %s", async (_name, change) => {
    const secrets = memorySecrets();
    secrets.values.set(
      "invalid",
      JSON.stringify({
        schemaVersion: 1,
        state: "ready",
        credential: { ...credential(1), ...change },
      }),
    );
    const repository = createSecureTwitchCredentialRepository({
      secrets,
      key: "invalid",
    });
    await expect(repository.read()).rejects.toThrow("credential is invalid");
  });

  it.each([
    ["empty device code", { deviceCode: "" }],
    ["infinite poll time", { nextPollAtEpochMs: Number.POSITIVE_INFINITY }],
    ["negative expiry", { expiresAtEpochMs: -1 }],
    ["zero interval", { intervalSeconds: 0 }],
  ])("rejects restored attempts with %s", async (_name, change) => {
    const secrets = memorySecrets();
    const repository = createSecureTwitchCredentialRepository({
      secrets,
      key: "invalid-attempt",
    });
    await begin(repository);
    const stored = JSON.parse(secrets.values.get("invalid-attempt") ?? "null");
    secrets.values.set(
      "invalid-attempt",
      JSON.stringify({ ...stored, attempt: { ...stored.attempt, ...change } }),
    );
    await expect(repository.read()).rejects.toThrow("attempt is invalid");
  });

  it("recovers a persisted poll reservation when no runtime owner remains", async () => {
    const secrets = memorySecrets();
    const original = createSecureTwitchCredentialRepository({
      secrets,
      key: "owned-poll",
    });
    await begin(original);
    await original.claimDevicePoll({
      attemptId: twitchAttemptId("attempt-1"),
      nowEpochMs: 5_000,
    });
    secrets.values.set("restored-poll", secrets.values.get("owned-poll") ?? "");
    const restored = createSecureTwitchCredentialRepository({
      secrets,
      key: "restored-poll",
    });
    await expect(
      restored.claimDevicePoll({
        attemptId: twitchAttemptId("attempt-1"),
        nowEpochMs: 10_000,
      }),
    ).resolves.toMatchObject({ kind: "claimed" });
  });
});
