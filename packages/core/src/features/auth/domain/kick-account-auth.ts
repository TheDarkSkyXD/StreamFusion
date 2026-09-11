import type {
  KickAccountId,
  KickAttemptId,
  KickCallbackInput,
  KickCallbackVerdict,
  KickCredentialGeneration,
  KickPersistedPkceAttempt,
} from "../capabilities/kick-account-auth.ts";
import { KICK_ANDROID_REDIRECT_URI } from "../capabilities/kick-account-auth.ts";

export function kickAccountId(value: string): KickAccountId {
  if (!value.trim()) throw new Error("Kick returned an invalid account ID.");
  return value as KickAccountId;
}

export function kickAttemptId(value: string): KickAttemptId {
  if (!value.trim()) throw new Error("The Kick attempt ID is invalid.");
  return value as KickAttemptId;
}

export function kickCredentialGeneration(
  value: number,
): KickCredentialGeneration {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("The Kick credential generation is invalid.");
  return value as KickCredentialGeneration;
}

export function isKickAndroidRedirectUri(value: string): boolean {
  return value === KICK_ANDROID_REDIRECT_URI;
}

export function judgeKickCallback(input: {
  readonly attempt: KickPersistedPkceAttempt | null;
  readonly callback: KickCallbackInput;
  readonly consumed: {
    readonly attemptId: KickAttemptId;
    readonly state: string;
  } | null;
  readonly replacedAttempts?: readonly {
    readonly attemptId: KickAttemptId;
    readonly state: string;
  }[];
}): KickCallbackVerdict {
  const replaced = input.replacedAttempts ?? [];
  if (
    input.callback.state !== null &&
    replaced.some((attempt) => attempt.state === input.callback.state)
  )
    return { kind: "superseded" };
  if (
    input.consumed !== null &&
    input.callback.state !== null &&
    input.consumed.state === input.callback.state
  )
    return { kind: "duplicate" };
  if (!input.attempt) return { kind: "stale" };
  if (
    !isKickAndroidRedirectUri(input.callback.redirectUri) ||
    !isKickAndroidRedirectUri(input.attempt.redirectUri)
  )
    return { kind: "wrong-redirect", attemptId: input.attempt.attemptId };
  if (input.callback.state !== input.attempt.state)
    return { kind: "state-mismatch", attemptId: input.attempt.attemptId };
  if (input.callback.receivedAtEpochMs >= input.attempt.expiresAtEpochMs)
    return { kind: "expired", attemptId: input.attempt.attemptId };
  if (input.callback.error)
    return {
      kind: "denied",
      attemptId: input.attempt.attemptId,
      reason: input.callback.error,
    };
  if (!input.callback.code)
    return {
      kind: "denied",
      attemptId: input.attempt.attemptId,
      reason: "missing-code",
    };
  return {
    kind: "accepted",
    attemptId: input.attempt.attemptId,
    code: input.callback.code,
  };
}
