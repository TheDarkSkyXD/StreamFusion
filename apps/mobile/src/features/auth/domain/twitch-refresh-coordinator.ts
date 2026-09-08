import {
  twitchCredentialGeneration,
  type TwitchCredential,
  type TwitchCredentialGeneration,
  type TwitchCredentialRepository,
  type TwitchCancellationSignal,
  type TwitchDeviceAuthorizationGateway,
} from "@streamfusion/core/auth";

export type TwitchRefreshResult =
  | { readonly kind: "refreshed"; readonly credential: TwitchCredential }
  | {
      readonly kind: "auth-lost";
      readonly reason: "refresh-outcome-unknown" | "refresh-rejected";
    }
  | { readonly kind: "transient-failure" }
  | { readonly kind: "stale" | "unavailable" };

export async function recoverInterruptedTwitchRefresh(
  repository: TwitchCredentialRepository,
): Promise<"recovered" | "stale" | "unchanged"> {
  const current = await repository.read();
  if (current.kind !== "refresh-in-flight") return "unchanged";
  return (await repository.markAuthLost({
    expectedGeneration: current.credential.generation,
    operationId: current.operationId,
    reason: "refresh-outcome-unknown",
  }))
    ? "recovered"
    : "stale";
}

export async function refreshTwitchCredential(input: {
  readonly gateway: TwitchDeviceAuthorizationGateway;
  readonly nowEpochMs: () => number;
  readonly operationId: string;
  readonly repository: TwitchCredentialRepository;
  readonly signal: TwitchCancellationSignal;
  readonly expectedGeneration: TwitchCredentialGeneration;
  readonly expectedClientId: string;
}): Promise<TwitchRefreshResult> {
  const claim = await input.repository.claimRefresh({
    expectedGeneration: input.expectedGeneration,
    operationId: input.operationId,
  });
  if (claim.kind !== "claimed") return { kind: claim.kind };
  const dispatched = await input.gateway.refresh(
    claim.credential.refreshToken,
    input.signal,
  );
  if (dispatched.kind === "not-sent") {
    const released = await input.repository.releaseRefreshClaim({
      expectedGeneration: input.expectedGeneration,
      operationId: input.operationId,
    });
    return released ? { kind: "transient-failure" } : { kind: "stale" };
  }
  if (dispatched.kind === "outcome-unknown" || dispatched.kind === "rejected") {
    const reason =
      dispatched.kind === "rejected"
        ? "refresh-rejected"
        : "refresh-outcome-unknown";
    const committed = await input.repository.markAuthLost({
      expectedGeneration: input.expectedGeneration,
      operationId: input.operationId,
      reason,
    });
    return committed ? { kind: "auth-lost", reason } : { kind: "stale" };
  }
  const validation = await input.gateway.validate(
    dispatched.accessToken,
    input.signal,
  );
  const validatedAtEpochMs = input.nowEpochMs();
  if (
    validation.kind !== "valid" ||
    validation.validation.clientId !== input.expectedClientId ||
    validation.validation.userId !== claim.credential.account.id
  ) {
    const reason =
      validation.kind === "revoked"
        ? "refresh-rejected"
        : "refresh-outcome-unknown";
    const committed = await input.repository.markAuthLost({
      expectedGeneration: input.expectedGeneration,
      operationId: input.operationId,
      reason,
    });
    return committed ? { kind: "auth-lost", reason } : { kind: "stale" };
  }
  const credential: TwitchCredential = {
    ...claim.credential,
    accessToken: dispatched.accessToken,
    refreshToken: dispatched.refreshToken,
    scopes: validation.validation.scopes,
    expiresAtEpochMs:
      validatedAtEpochMs + validation.validation.expiresInSeconds * 1_000,
    generation: twitchCredentialGeneration(input.expectedGeneration + 1),
    validatedAtEpochMs,
  };
  return (await input.repository.commitRefresh({
    credential,
    expectedGeneration: input.expectedGeneration,
    operationId: input.operationId,
  }))
    ? { kind: "refreshed", credential }
    : { kind: "stale" };
}
