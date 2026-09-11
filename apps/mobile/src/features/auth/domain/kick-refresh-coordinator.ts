import {
  kickCredentialGeneration,
  type KickAuthorizationGateway,
  type KickCancellationSignal,
  type KickCredential,
  type KickCredentialGeneration,
  type KickCredentialRepository,
} from "@streamfusion/core/auth";

export type KickRefreshResult =
  | { readonly kind: "refreshed"; readonly credential: KickCredential }
  | {
      readonly kind: "auth-lost";
      readonly reason: "refresh-outcome-unknown" | "refresh-rejected";
    }
  | { readonly kind: "transient-failure" }
  | { readonly kind: "stale" | "unavailable" };

export async function recoverInterruptedKickRefresh(
  repository: KickCredentialRepository,
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

export async function refreshKickCredential(input: {
  readonly expectedGeneration: KickCredentialGeneration;
  readonly gateway: KickAuthorizationGateway;
  readonly nowEpochMs: () => number;
  readonly operationId: string;
  readonly repository: KickCredentialRepository;
  readonly signal: KickCancellationSignal;
}): Promise<KickRefreshResult> {
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
      dispatched.kind === "rejected" ? "refresh-rejected" : "refresh-outcome-unknown";
    const committed = await input.repository.markAuthLost({
      expectedGeneration: input.expectedGeneration,
      operationId: input.operationId,
      reason,
    });
    return committed ? { kind: "auth-lost", reason } : { kind: "stale" };
  }
  const account = await input.gateway.loadAccount(dispatched.accessToken, input.signal);
  if (
    account.kind !== "found" ||
    account.account.id !== claim.credential.account.id
  ) {
    const reason = account.kind === "revoked" ? "revoked" : "refresh-outcome-unknown";
    const committed = await input.repository.markAuthLost({
      expectedGeneration: input.expectedGeneration,
      operationId: input.operationId,
      reason,
    });
    return committed
      ? { kind: "auth-lost", reason: "refresh-outcome-unknown" }
      : { kind: "stale" };
  }
  const validatedAtEpochMs = input.nowEpochMs();
  const credential: KickCredential = {
    accessToken: dispatched.accessToken,
    refreshToken: dispatched.refreshToken,
    expiresAtEpochMs: validatedAtEpochMs + dispatched.expiresInSeconds * 1_000,
    validatedAtEpochMs,
    generation: kickCredentialGeneration(input.expectedGeneration + 1),
    scopes: dispatched.scopes,
    account: account.account,
  };
  return (await input.repository.commitRefresh({
    credential,
    expectedGeneration: input.expectedGeneration,
    operationId: input.operationId,
  }))
    ? { kind: "refreshed", credential }
    : { kind: "stale" };
}
