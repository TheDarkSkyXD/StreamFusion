import type { TwitchAttemptId } from "../capabilities/twitch-account-auth.ts";
import type {
  TwitchAccountId,
  TwitchCredentialGeneration,
} from "../capabilities/twitch-account-auth.ts";

export function twitchAccountId(value: string): TwitchAccountId {
  if (!value.trim()) throw new Error("Twitch returned an invalid account ID.");
  return value as TwitchAccountId;
}

export function twitchAttemptId(value: string): TwitchAttemptId {
  if (!value.trim()) throw new Error("The Twitch attempt ID is invalid.");
  return value as TwitchAttemptId;
}

export function twitchCredentialGeneration(
  value: number,
): TwitchCredentialGeneration {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("The Twitch credential generation is invalid.");
  return value as TwitchCredentialGeneration;
}

export type TwitchDeviceCodeState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting"; readonly attemptId: TwitchAttemptId }
  | {
      readonly kind: "pending";
      readonly attemptId: TwitchAttemptId;
      readonly expiresAtEpochMs: number;
      readonly nextPollAtEpochMs: number;
      readonly userCode: string;
      readonly verificationUri: string;
    }
  | {
      readonly kind: "validating" | "committing";
      readonly attemptId: TwitchAttemptId;
    }
  | {
      readonly kind: "failed";
      readonly attemptId: TwitchAttemptId;
      readonly reason:
        "denied" | "expired" | "offline" | "provider" | "storage";
    };

export function nextDevicePollAt(input: {
  readonly intervalSeconds: number;
  readonly nowEpochMs: number;
}): number {
  if (!Number.isInteger(input.intervalSeconds) || input.intervalSeconds <= 0)
    throw new Error("Twitch returned an invalid polling interval.");
  return input.nowEpochMs + input.intervalSeconds * 1_000;
}

export function canPollDeviceCode(input: {
  readonly attemptId: TwitchAttemptId;
  readonly nowEpochMs: number;
  readonly state: TwitchDeviceCodeState;
}): boolean {
  return (
    input.state.kind === "pending" &&
    input.state.attemptId === input.attemptId &&
    input.nowEpochMs >= input.state.nextPollAtEpochMs &&
    input.nowEpochMs < input.state.expiresAtEpochMs
  );
}

export function shouldValidateTwitchSession(input: {
  readonly lastValidatedAtEpochMs: number;
  readonly nowEpochMs: number;
}): boolean {
  return input.nowEpochMs - input.lastValidatedAtEpochMs >= 60 * 60 * 1_000;
}

export function missingScopes(
  granted: readonly string[],
  required: readonly string[],
): readonly string[] {
  const available = new Set(granted);
  return required.filter((scope) => !available.has(scope));
}
