import {
  missingScopes,
  nextDevicePollAt,
  twitchCredentialGeneration,
  type TwitchAttemptId,
  type TwitchCancellationSignal,
  type TwitchCredentialGeneration,
  type TwitchCredentialRepository,
  type TwitchDeviceAuthorizationGateway,
  type TwitchPersistedDeviceAttempt,
} from "@streamfusion/core/auth";

export type StartTwitchDeviceCodeResult =
  | {
      readonly kind: "pending";
      readonly attempt: Omit<TwitchPersistedDeviceAttempt, "deviceCode">;
    }
  | { readonly kind: "stale" };

export type PollTwitchDeviceCodeResult =
  | {
      readonly kind: "pending";
      readonly nextPollAtEpochMs: number;
      readonly status: "waiting" | "offline";
    }
  | { readonly kind: "connected"; readonly missingScopes: readonly string[] }
  | { readonly kind: "denied" | "expired" | "stale" }
  | { readonly kind: "reconnect-required" };

export async function startTwitchDeviceCode(input: {
  readonly attemptId: TwitchAttemptId;
  readonly expectedGeneration: TwitchCredentialGeneration;
  readonly gateway: TwitchDeviceAuthorizationGateway;
  readonly nowEpochMs: () => number;
  readonly repository: TwitchCredentialRepository;
  readonly scopes: readonly string[];
  readonly signal: TwitchCancellationSignal;
}): Promise<StartTwitchDeviceCodeResult> {
  if (
    !(await input.repository.beginRequest({
      attemptId: input.attemptId,
      expectedGeneration: input.expectedGeneration,
    }))
  )
    return { kind: "stale" };
  const startedAtEpochMs = input.nowEpochMs();
  let authorization;
  try {
    authorization = await input.gateway.request(input.scopes, input.signal);
  } catch (error) {
    await input.repository.clearAttempt(input.attemptId);
    throw error;
  }
  const attempt: TwitchPersistedDeviceAttempt = {
    ...authorization,
    attemptId: input.attemptId,
    generation: input.expectedGeneration,
    expiresAtEpochMs: startedAtEpochMs + authorization.expiresInSeconds * 1_000,
    nextPollAtEpochMs: nextDevicePollAt({
      intervalSeconds: authorization.intervalSeconds,
      nowEpochMs: input.nowEpochMs(),
    }),
  };
  if (
    !(await input.repository.beginAttempt({
      attempt,
      expectedGeneration: input.expectedGeneration,
    }))
  )
    return { kind: "stale" };
  const { deviceCode: _, ...safeAttempt } = attempt;
  return { kind: "pending", attempt: safeAttempt };
}

export async function pollTwitchDeviceCode(input: {
  readonly attemptId: TwitchAttemptId;
  readonly expectedClientId: string;
  readonly gateway: TwitchDeviceAuthorizationGateway;
  readonly nowEpochMs: () => number;
  readonly repository: TwitchCredentialRepository;
  readonly requiredScopes: readonly string[];
  readonly signal: TwitchCancellationSignal;
  readonly onProgress?: (phase: "validating" | "committing") => void;
}): Promise<PollTwitchDeviceCodeResult> {
  const claim = await input.repository.claimDevicePoll({
    attemptId: input.attemptId,
    nowEpochMs: input.nowEpochMs(),
  });
  if (claim.kind === "stale") return { kind: "stale" };
  if (claim.kind === "not-due") {
    const current = await input.repository.read();
    return (current.kind === "connecting" ||
      current.kind === "poll-in-flight") &&
      current.attempt.attemptId === input.attemptId
      ? {
          kind: "pending",
          nextPollAtEpochMs: current.attempt.nextPollAtEpochMs,
          status: "waiting",
        }
      : { kind: "stale" };
  }
  if (claim.kind === "expired")
    return (await input.repository.clearAttempt(input.attemptId))
      ? { kind: "expired" }
      : { kind: "stale" };
  const current = claim;
  let polled;
  try {
    polled = await input.gateway.poll(current.attempt.deviceCode, input.signal);
  } catch (error) {
    await input.repository.beginAttempt({
      expectedGeneration: current.attempt.generation,
      attempt: {
        ...current.attempt,
        nextPollAtEpochMs: nextDevicePollAt({
          intervalSeconds: current.attempt.intervalSeconds,
          nowEpochMs: input.nowEpochMs(),
        }),
      },
    });
    throw error;
  }
  const responseAtEpochMs = input.nowEpochMs();
  if (
    polled.kind === "pending" ||
    polled.kind === "slow-down" ||
    polled.kind === "transient-failure"
  ) {
    const intervalSeconds =
      polled.kind === "slow-down"
        ? Math.max(
            current.attempt.intervalSeconds + 5,
            polled.retryAfterSeconds ?? 0,
          )
        : polled.kind === "transient-failure"
          ? current.attempt.intervalSeconds * 2
          : current.attempt.intervalSeconds;
    const nextPollAtEpochMs = nextDevicePollAt({
      intervalSeconds,
      nowEpochMs: responseAtEpochMs,
    });
    const saved = await input.repository.beginAttempt({
      expectedGeneration: current.attempt.generation,
      attempt: { ...current.attempt, intervalSeconds, nextPollAtEpochMs },
    });
    return saved
      ? {
          kind: "pending",
          nextPollAtEpochMs,
          status: polled.kind === "transient-failure" ? "offline" : "waiting",
        }
      : { kind: "stale" };
  }
  if (polled.kind === "denied" || polled.kind === "expired") {
    return (await input.repository.clearAttempt(input.attemptId))
      ? { kind: polled.kind }
      : { kind: "stale" };
  }
  input.onProgress?.("validating");
  const validation = await input.gateway.validate(
    polled.accessToken,
    input.signal,
  );
  const validatedAtEpochMs = input.nowEpochMs();
  if (
    validation.kind !== "valid" ||
    validation.validation.clientId !== input.expectedClientId
  ) {
    const committed = await input.repository.markAuthLost({
      expectedGeneration: current.attempt.generation,
      attemptId: input.attemptId,
      reason: "connection-validation-failed",
    });
    return committed ? { kind: "reconnect-required" } : { kind: "stale" };
  }
  const account = await input.gateway.loadAccount(
    polled.accessToken,
    validation.validation.userId,
    input.signal,
  );
  if (account.kind !== "found") {
    const committed = await input.repository.markAuthLost({
      expectedGeneration: current.attempt.generation,
      attemptId: input.attemptId,
      reason: "connection-validation-failed",
    });
    return committed ? { kind: "reconnect-required" } : { kind: "stale" };
  }
  const credential = {
    accessToken: polled.accessToken,
    refreshToken: polled.refreshToken,
    account: account.account,
    scopes: validation.validation.scopes,
    expiresAtEpochMs:
      validatedAtEpochMs + validation.validation.expiresInSeconds * 1_000,
    validatedAtEpochMs,
    generation: twitchCredentialGeneration(current.attempt.generation + 1),
  };
  input.onProgress?.("committing");
  return (await input.repository.commitConnection({
    attemptId: input.attemptId,
    credential,
    expectedGeneration: current.attempt.generation,
  }))
    ? {
        kind: "connected",
        missingScopes: missingScopes(
          validation.validation.scopes,
          input.requiredScopes,
        ),
      }
    : { kind: "stale" };
}
