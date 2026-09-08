import {
  twitchAccountId,
  twitchAttemptId,
  twitchCredentialGeneration,
  type TwitchAccountIdentity,
  type TwitchCredential,
  type TwitchCredentialGeneration,
  type TwitchCredentialRepository,
  type TwitchCredentialSnapshot,
  type TwitchDevicePollClaimResult,
  type TwitchRefreshClaimResult,
  type TwitchPersistedDeviceAttempt,
} from "@streamfusion/core/auth";

import type { SecureSecretStore } from "@mobile/features/storage/capabilities/persistence";

type StoredEnvelope =
  | {
      readonly schemaVersion: 1;
      readonly state: "disconnected";
      readonly generation: number;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "ready";
      readonly credential: TwitchCredential;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "connecting";
      readonly attempt: TwitchPersistedDeviceAttempt;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "poll-in-flight";
      readonly attempt: TwitchPersistedDeviceAttempt;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "requesting";
      readonly attemptId: TwitchPersistedDeviceAttempt["attemptId"];
      readonly generation: number;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "refresh-in-flight";
      readonly credential: TwitchCredential;
      readonly operationId: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "auth-lost";
      readonly account: TwitchAccountIdentity | null;
      readonly generation: number;
      readonly reason:
        | "connection-validation-failed"
        | "refresh-outcome-unknown"
        | "refresh-rejected"
        | "revoked";
    };

const defaultKey = "streamfusion.main.twitch-auth.v1";
const queuesByKey = new Map<string, Promise<void>>();
const activePollsByKey = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAccount(value: unknown): TwitchAccountIdentity {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.login !== "string" ||
    !value.login ||
    typeof value.displayName !== "string" ||
    !value.displayName ||
    (value.profileImageUrl !== null &&
      typeof value.profileImageUrl !== "string")
  )
    throw new Error("The stored Twitch account is invalid.");
  const profileImageUrl = value.profileImageUrl;
  return {
    id: twitchAccountId(value.id),
    login: value.login,
    displayName: value.displayName,
    profileImageUrl,
  };
}

function isAuthLostReason(
  value: unknown,
): value is Extract<StoredEnvelope, { state: "auth-lost" }>["reason"] {
  return (
    value === "connection-validation-failed" ||
    value === "refresh-outcome-unknown" ||
    value === "refresh-rejected" ||
    value === "revoked"
  );
}

function parseCredential(value: unknown): TwitchCredential {
  if (
    !isRecord(value) ||
    typeof value.accessToken !== "string" ||
    !value.accessToken ||
    typeof value.refreshToken !== "string" ||
    !value.refreshToken ||
    !isNonnegativeInteger(value.expiresAtEpochMs) ||
    !isNonnegativeInteger(value.validatedAtEpochMs) ||
    !isNonnegativeInteger(value.generation) ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === "string")
  )
    throw new Error("The stored Twitch credential is invalid.");
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAtEpochMs: value.expiresAtEpochMs,
    validatedAtEpochMs: value.validatedAtEpochMs,
    generation: twitchCredentialGeneration(value.generation),
    scopes: value.scopes,
    account: parseAccount(value.account),
  };
}

function parseAttempt(value: unknown): TwitchPersistedDeviceAttempt {
  if (
    !isRecord(value) ||
    typeof value.attemptId !== "string" ||
    !value.attemptId ||
    typeof value.deviceCode !== "string" ||
    !value.deviceCode ||
    typeof value.userCode !== "string" ||
    !value.userCode ||
    !isTwitchVerificationUri(value.verificationUri) ||
    !isNonnegativeInteger(value.expiresAtEpochMs) ||
    !isNonnegativeInteger(value.nextPollAtEpochMs) ||
    !isPositiveInteger(value.expiresInSeconds) ||
    !isPositiveInteger(value.intervalSeconds) ||
    !isNonnegativeInteger(value.generation)
  )
    throw new Error("The stored Twitch Device Code attempt is invalid.");
  return {
    attemptId: twitchAttemptId(value.attemptId),
    deviceCode: value.deviceCode,
    userCode: value.userCode,
    verificationUri: value.verificationUri,
    expiresAtEpochMs: value.expiresAtEpochMs,
    nextPollAtEpochMs: value.nextPollAtEpochMs,
    expiresInSeconds: value.expiresInSeconds,
    intervalSeconds: value.intervalSeconds,
    generation: twitchCredentialGeneration(value.generation),
  };
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isTwitchVerificationUri(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    const uri = new URL(value);
    return uri.protocol === "https:" && uri.hostname === "www.twitch.tv";
  } catch {
    return false;
  }
}

function parseEnvelope(serialized: string): StoredEnvelope {
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.state !== "string"
  )
    throw new Error("The stored Twitch authentication envelope is invalid.");
  if (value.state === "ready")
    return {
      schemaVersion: 1,
      state: "ready",
      credential: parseCredential(value.credential),
    };
  if (value.state === "connecting" || value.state === "poll-in-flight")
    return {
      schemaVersion: 1,
      state: value.state,
      attempt: parseAttempt(value.attempt),
    };
  if (
    value.state === "requesting" &&
    typeof value.attemptId === "string" &&
    value.attemptId.length > 0 &&
    isNonnegativeInteger(value.generation)
  )
    return {
      schemaVersion: 1,
      state: "requesting",
      attemptId: twitchAttemptId(value.attemptId),
      generation: twitchCredentialGeneration(value.generation),
    };
  if (
    value.state === "refresh-in-flight" &&
    typeof value.operationId === "string" &&
    value.operationId.length > 0
  )
    return {
      schemaVersion: 1,
      state: "refresh-in-flight",
      credential: parseCredential(value.credential),
      operationId: value.operationId,
    };
  if (value.state === "disconnected" && isNonnegativeInteger(value.generation))
    return {
      schemaVersion: 1,
      state: "disconnected",
      generation: twitchCredentialGeneration(value.generation),
    };
  if (
    value.state === "auth-lost" &&
    isNonnegativeInteger(value.generation) &&
    isAuthLostReason(value.reason)
  )
    return {
      schemaVersion: 1,
      state: "auth-lost",
      generation: twitchCredentialGeneration(value.generation),
      account: value.account === null ? null : parseAccount(value.account),
      reason: value.reason,
    };
  throw new Error("The stored Twitch authentication envelope is invalid.");
}

function snapshot(envelope: StoredEnvelope): TwitchCredentialSnapshot {
  switch (envelope.state) {
    case "disconnected":
      return {
        kind: "disconnected",
        generation: twitchCredentialGeneration(envelope.generation),
      };
    case "ready":
      return { kind: "ready", credential: envelope.credential };
    case "connecting":
      return { kind: "connecting", attempt: envelope.attempt };
    case "poll-in-flight":
      return { kind: "poll-in-flight", attempt: envelope.attempt };
    case "requesting":
      return {
        kind: "requesting",
        attemptId: envelope.attemptId,
        generation: twitchCredentialGeneration(envelope.generation),
      };
    case "refresh-in-flight":
      return {
        kind: "refresh-in-flight",
        account: envelope.credential.account,
        credential: envelope.credential,
        operationId: envelope.operationId,
      };
    case "auth-lost":
      return {
        kind: "auth-lost",
        account: envelope.account,
        generation: twitchCredentialGeneration(envelope.generation),
        reason: envelope.reason,
      };
  }
}

function generationOf(
  value: TwitchCredentialSnapshot,
): TwitchCredentialGeneration {
  if (value.kind === "connecting" || value.kind === "poll-in-flight")
    return value.attempt.generation;
  if (value.kind === "requesting") return value.generation;
  return value.kind === "ready" || value.kind === "refresh-in-flight"
    ? value.credential.generation
    : value.generation;
}

export function createSecureTwitchCredentialRepository(options: {
  readonly secrets: SecureSecretStore;
  readonly key?: string;
}): TwitchCredentialRepository {
  const key = options.key ?? defaultKey;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const queue = queuesByKey.get(key) ?? Promise.resolve();
    const result = queue.then(operation, operation);
    queuesByKey.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };
  const readCurrent = async (): Promise<TwitchCredentialSnapshot> => {
    const value = await options.secrets.get(key);
    return value === null
      ? { kind: "disconnected", generation: twitchCredentialGeneration(0) }
      : snapshot(parseEnvelope(value));
  };
  const write = async (envelope: StoredEnvelope): Promise<void> => {
    const serialized = JSON.stringify(envelope);
    await options.secrets.set(key, serialized);
    if ((await options.secrets.get(key)) !== serialized)
      throw new Error(
        "The Twitch authentication envelope could not be verified.",
      );
  };

  return {
    read: () => serialize(readCurrent),
    beginRequest: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (generationOf(current) !== input.expectedGeneration) return false;
        await write({
          schemaVersion: 1,
          state: "requesting",
          attemptId: input.attemptId,
          generation: input.expectedGeneration,
        });
        activePollsByKey.delete(key);
        return true;
      }),
    beginAttempt: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          (current.kind !== "requesting" &&
            current.kind !== "connecting" &&
            current.kind !== "poll-in-flight") ||
          (current.kind === "requesting"
            ? current.attemptId
            : current.attempt.attemptId) !== input.attempt.attemptId ||
          generationOf(current) !== input.expectedGeneration ||
          input.attempt.generation !== input.expectedGeneration
        )
          return false;
        await write({
          schemaVersion: 1,
          state: "connecting",
          attempt: input.attempt,
        });
        activePollsByKey.delete(key);
        return true;
      }),
    clearAttempt: (attemptId) =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          (current.kind !== "connecting" &&
            current.kind !== "poll-in-flight" &&
            current.kind !== "requesting") ||
          (current.kind === "connecting" || current.kind === "poll-in-flight"
            ? current.attempt.attemptId
            : current.attemptId) !== attemptId
        )
          return false;
        await write({
          schemaVersion: 1,
          state: "disconnected",
          generation: generationOf(current),
        });
        activePollsByKey.delete(key);
        return true;
      }),
    claimDevicePoll: (input): Promise<TwitchDevicePollClaimResult> =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          (current.kind !== "connecting" &&
            current.kind !== "poll-in-flight") ||
          current.attempt.attemptId !== input.attemptId
        )
          return { kind: "stale" };
        if (input.nowEpochMs >= current.attempt.expiresAtEpochMs)
          return { kind: "expired" };
        if (input.nowEpochMs < current.attempt.nextPollAtEpochMs)
          return { kind: "not-due" };
        if (activePollsByKey.has(key)) return { kind: "not-due" };
        const attempt = {
          ...current.attempt,
          nextPollAtEpochMs:
            input.nowEpochMs + current.attempt.intervalSeconds * 1_000,
        };
        await write({
          schemaVersion: 1,
          state: "poll-in-flight",
          attempt,
        });
        activePollsByKey.add(key);
        return { kind: "claimed", attempt };
      }),
    claimRefresh: (input): Promise<TwitchRefreshClaimResult> =>
      serialize(async () => {
        const current = await readCurrent();
        if (current.kind !== "ready") return { kind: "unavailable" };
        if (current.credential.generation !== input.expectedGeneration)
          return { kind: "stale" };
        await write({
          schemaVersion: 1,
          state: "refresh-in-flight",
          credential: current.credential,
          operationId: input.operationId,
        });
        return {
          kind: "claimed",
          credential: current.credential,
          operationId: input.operationId,
        };
      }),
    commitConnection: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          (current.kind !== "connecting" &&
            current.kind !== "poll-in-flight") ||
          current.attempt.attemptId !== input.attemptId ||
          current.attempt.generation !== input.expectedGeneration ||
          input.credential.generation !== input.expectedGeneration + 1
        )
          return false;
        await write({
          schemaVersion: 1,
          state: "ready",
          credential: input.credential,
        });
        activePollsByKey.delete(key);
        return true;
      }),
    commitRefresh: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          current.kind !== "refresh-in-flight" ||
          current.operationId !== input.operationId ||
          current.credential.generation !== input.expectedGeneration ||
          input.credential.generation !== input.expectedGeneration + 1
        )
          return false;
        await write({
          schemaVersion: 1,
          state: "ready",
          credential: input.credential,
        });
        return true;
      }),
    commitValidation: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          current.kind !== "ready" ||
          current.credential.generation !== input.expectedGeneration ||
          current.credential.account.id !== input.accountId ||
          input.validatedAtEpochMs <= current.credential.validatedAtEpochMs ||
          !Number.isFinite(input.validatedAtEpochMs) ||
          !Number.isFinite(input.expiresAtEpochMs) ||
          input.expiresAtEpochMs <= input.validatedAtEpochMs
        )
          return false;
        await write({
          schemaVersion: 1,
          state: "ready",
          credential: {
            ...current.credential,
            scopes: input.scopes,
            expiresAtEpochMs: input.expiresAtEpochMs,
            validatedAtEpochMs: input.validatedAtEpochMs,
          },
        });
        return true;
      }),
    disconnect: (expectedGeneration) =>
      serialize(async () => {
        const current = await readCurrent();
        if (generationOf(current) !== expectedGeneration) return false;
        await write({
          schemaVersion: 1,
          state: "disconnected",
          generation: expectedGeneration + 1,
        });
        activePollsByKey.delete(key);
        return true;
      }),
    markAuthLost: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (generationOf(current) !== input.expectedGeneration) return false;
        if (
          input.attemptId !== undefined &&
          ((current.kind !== "connecting" &&
            current.kind !== "poll-in-flight") ||
            current.attempt.attemptId !== input.attemptId)
        )
          return false;
        if (
          input.operationId !== undefined &&
          (current.kind !== "refresh-in-flight" ||
            current.operationId !== input.operationId)
        )
          return false;
        const account =
          current.kind === "ready" || current.kind === "refresh-in-flight"
            ? current.credential.account
            : current.kind === "auth-lost"
              ? current.account
              : null;
        await write({
          schemaVersion: 1,
          state: "auth-lost",
          account,
          generation: input.expectedGeneration + 1,
          reason: input.reason,
        });
        activePollsByKey.delete(key);
        return true;
      }),
    releaseRefreshClaim: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          current.kind !== "refresh-in-flight" ||
          current.operationId !== input.operationId ||
          current.credential.generation !== input.expectedGeneration
        )
          return false;
        await write({
          schemaVersion: 1,
          state: "ready",
          credential: current.credential,
        });
        return true;
      }),
  };
}
