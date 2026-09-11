import {
  kickAccountId,
  kickAttemptId,
  kickCredentialGeneration,
  type KickAccountIdentity,
  type KickCredential,
  type KickCredentialGeneration,
  type KickCredentialRepository,
  type KickCredentialSnapshot,
  type KickExchangeClaimResult,
  type KickPersistedPkceAttempt,
  type KickRefreshClaimResult,
} from "@streamfusion/core/auth";

import type { SecureSecretStore } from "@mobile/features/storage/capabilities/persistence";

type StoredEnvelope =
  | { readonly schemaVersion: 1; readonly state: "disconnected"; readonly generation: number }
  | { readonly schemaVersion: 1; readonly state: "ready"; readonly credential: KickCredential }
  | {
      readonly schemaVersion: 1;
      readonly state: "launching" | "pending" | "exchanging";
      readonly attempt: KickPersistedPkceAttempt;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "refresh-in-flight";
      readonly credential: KickCredential;
      readonly operationId: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly state: "auth-lost";
      readonly account: KickAccountIdentity | null;
      readonly generation: number;
      readonly reason:
        | "connection-validation-failed"
        | "refresh-outcome-unknown"
        | "refresh-rejected"
        | "revoked";
    };

const defaultKey = "streamfusion.main.kick-auth.v1";
const queuesByKey = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseAccount(value: unknown): KickAccountIdentity {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.login !== "string" ||
    !value.login ||
    typeof value.displayName !== "string" ||
    !value.displayName ||
    (value.profileImageUrl !== null && typeof value.profileImageUrl !== "string")
  )
    throw new Error("The stored Kick account is invalid.");
  return {
    id: kickAccountId(value.id),
    login: value.login,
    displayName: value.displayName,
    profileImageUrl: value.profileImageUrl,
  };
}

function parseCredential(value: unknown): KickCredential {
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
    throw new Error("The stored Kick credential is invalid.");
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAtEpochMs: value.expiresAtEpochMs,
    validatedAtEpochMs: value.validatedAtEpochMs,
    generation: kickCredentialGeneration(value.generation),
    scopes: value.scopes,
    account: parseAccount(value.account),
  };
}

function parseAttempt(value: unknown): KickPersistedPkceAttempt {
  if (
    !isRecord(value) ||
    typeof value.attemptId !== "string" ||
    !value.attemptId ||
    typeof value.codeVerifier !== "string" ||
    !value.codeVerifier ||
    typeof value.state !== "string" ||
    !value.state ||
    typeof value.redirectUri !== "string" ||
    !value.redirectUri ||
    !isNonnegativeInteger(value.expiresAtEpochMs) ||
    !isNonnegativeInteger(value.generation)
  )
    throw new Error("The stored Kick PKCE attempt is invalid.");
  return {
    attemptId: kickAttemptId(value.attemptId),
    codeVerifier: value.codeVerifier,
    state: value.state,
    redirectUri: value.redirectUri,
    expiresAtEpochMs: value.expiresAtEpochMs,
    generation: kickCredentialGeneration(value.generation),
  };
}

function parseEnvelope(serialized: string): StoredEnvelope {
  const value: unknown = JSON.parse(serialized);
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.state !== "string")
    throw new Error("The stored Kick authentication envelope is invalid.");
  if (value.state === "ready")
    return { schemaVersion: 1, state: "ready", credential: parseCredential(value.credential) };
  if (value.state === "launching" || value.state === "pending" || value.state === "exchanging")
    return { schemaVersion: 1, state: value.state, attempt: parseAttempt(value.attempt) };
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
      generation: kickCredentialGeneration(value.generation),
    };
  if (
    value.state === "auth-lost" &&
    isNonnegativeInteger(value.generation) &&
    (value.reason === "connection-validation-failed" ||
      value.reason === "refresh-outcome-unknown" ||
      value.reason === "refresh-rejected" ||
      value.reason === "revoked")
  )
    return {
      schemaVersion: 1,
      state: "auth-lost",
      generation: kickCredentialGeneration(value.generation),
      account: value.account === null ? null : parseAccount(value.account),
      reason: value.reason,
    };
  throw new Error("The stored Kick authentication envelope is invalid.");
}

function snapshot(envelope: StoredEnvelope): KickCredentialSnapshot {
  switch (envelope.state) {
    case "disconnected":
      return { kind: "disconnected", generation: kickCredentialGeneration(envelope.generation) };
    case "ready":
      return { kind: "ready", credential: envelope.credential };
    case "launching":
    case "pending":
    case "exchanging":
      return { kind: envelope.state, attempt: envelope.attempt };
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
        generation: kickCredentialGeneration(envelope.generation),
        reason: envelope.reason,
      };
  }
}

function generationOf(value: KickCredentialSnapshot): KickCredentialGeneration {
  switch (value.kind) {
    case "launching":
    case "pending":
    case "exchanging":
      return value.attempt.generation;
    case "ready":
    case "refresh-in-flight":
      return value.credential.generation;
    case "disconnected":
    case "auth-lost":
      return value.generation;
  }
}

export function createSecureKickCredentialRepository(options: {
  readonly secrets: SecureSecretStore;
  readonly key?: string;
}): KickCredentialRepository {
  const key = options.key ?? defaultKey;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const queue = queuesByKey.get(key) ?? Promise.resolve();
    const result = queue.then(operation, operation);
    queuesByKey.set(key, result.then(() => undefined, () => undefined));
    return result;
  };
  const readCurrent = async (): Promise<KickCredentialSnapshot> => {
    const value = await options.secrets.get(key);
    return value === null
      ? { kind: "disconnected", generation: kickCredentialGeneration(0) }
      : snapshot(parseEnvelope(value));
  };
  const write = async (envelope: StoredEnvelope): Promise<void> => {
    const serialized = JSON.stringify(envelope);
    await options.secrets.set(key, serialized);
    if ((await options.secrets.get(key)) !== serialized)
      throw new Error("The Kick authentication envelope could not be verified.");
  };

  return {
    read: () => serialize(readCurrent),
    beginLaunch: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (generationOf(current) !== input.expectedGeneration) return false;
        if (
          current.kind !== "disconnected" &&
          current.kind !== "auth-lost" &&
          current.kind !== "launching" &&
          current.kind !== "pending" &&
          current.kind !== "exchanging"
        )
          return false;
        if (input.attempt.generation !== input.expectedGeneration) return false;
        await write({ schemaVersion: 1, state: "launching", attempt: input.attempt });
        return true;
      }),
    markPending: (attemptId) =>
      serialize(async () => {
        const current = await readCurrent();
        if (current.kind !== "launching" || current.attempt.attemptId !== attemptId)
          return false;
        await write({ schemaVersion: 1, state: "pending", attempt: current.attempt });
        return true;
      }),
    claimExchange: (input): Promise<KickExchangeClaimResult> =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          (current.kind !== "pending" && current.kind !== "exchanging") ||
          current.attempt.attemptId !== input.attemptId
        )
          return { kind: "stale" };
        if (input.nowEpochMs >= current.attempt.expiresAtEpochMs) return { kind: "expired" };
        await write({ schemaVersion: 1, state: "exchanging", attempt: current.attempt });
        return { kind: "claimed", attempt: current.attempt };
      }),
    clearAttempt: (attemptId) =>
      serialize(async () => {
        const current = await readCurrent();
        if (
          (current.kind !== "launching" &&
            current.kind !== "pending" &&
            current.kind !== "exchanging") ||
          current.attempt.attemptId !== attemptId
        )
          return false;
        await write({
          schemaVersion: 1,
          state: "disconnected",
          generation: generationOf(current),
        });
        return true;
      }),
    claimRefresh: (input): Promise<KickRefreshClaimResult> =>
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
          current.kind !== "exchanging" ||
          current.attempt.attemptId !== input.attemptId ||
          current.attempt.generation !== input.expectedGeneration ||
          input.credential.generation !== input.expectedGeneration + 1
        )
          return false;
        await write({ schemaVersion: 1, state: "ready", credential: input.credential });
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
        await write({ schemaVersion: 1, state: "ready", credential: input.credential });
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
        return true;
      }),
    markAuthLost: (input) =>
      serialize(async () => {
        const current = await readCurrent();
        if (generationOf(current) !== input.expectedGeneration) return false;
        if (
          input.attemptId !== undefined &&
          ((current.kind !== "launching" &&
            current.kind !== "pending" &&
            current.kind !== "exchanging") ||
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
        await write({ schemaVersion: 1, state: "ready", credential: current.credential });
        return true;
      }),
  };
}
