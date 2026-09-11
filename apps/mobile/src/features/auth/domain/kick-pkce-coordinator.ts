import {
  judgeKickCallback,
  kickCredentialGeneration,
  missingScopes,
  type KickAttemptId,
  type KickAuthorizationGateway,
  type KickCallbackInput,
  type KickCancellationSignal,
  type KickCredential,
  type KickCredentialGeneration,
  type KickCredentialRepository,
  type KickPersistedPkceAttempt,
} from "@streamfusion/core/auth";

export type CompleteKickAuthorizationResult =
  | { readonly kind: "connected"; readonly credential: KickCredential; readonly missingScopes: readonly string[] }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "expired" | "stale" | "duplicate" | "state-mismatch" | "wrong-redirect" | "superseded" }
  | { readonly kind: "offline" }
  | { readonly kind: "rejected" };

export async function startKickAuthorization(input: {
  readonly attempt: KickPersistedPkceAttempt;
  readonly expectedGeneration: KickCredentialGeneration;
  readonly repository: KickCredentialRepository;
}): Promise<"pending" | "stale"> {
  if (
    !(await input.repository.beginLaunch({
      attempt: input.attempt,
      expectedGeneration: input.expectedGeneration,
    }))
  )
    return "stale";
  return (await input.repository.markPending(input.attempt.attemptId))
    ? "pending"
    : "stale";
}

export async function completeKickAuthorization(input: {
  readonly callback: KickCallbackInput;
  readonly consumed: { readonly attemptId: KickAttemptId; readonly state: string } | null;
  readonly gateway: KickAuthorizationGateway;
  readonly nowEpochMs: () => number;
  readonly replacedAttempts: readonly {
    readonly attemptId: KickAttemptId;
    readonly state: string;
  }[];
  readonly requiredScopes: readonly string[];
  readonly repository: KickCredentialRepository;
  readonly signal: KickCancellationSignal;
}): Promise<CompleteKickAuthorizationResult> {
  const durable = await input.repository.read();
  const attempt =
    durable.kind === "launching" || durable.kind === "pending" || durable.kind === "exchanging"
      ? durable.attempt
      : null;
  const verdict = judgeKickCallback({
    attempt,
    callback: input.callback,
    consumed: input.consumed,
    replacedAttempts: input.replacedAttempts,
  });
  if (verdict.kind !== "accepted") return verdict;
  const claimed = await input.repository.claimExchange({
    attemptId: verdict.attemptId,
    nowEpochMs: input.nowEpochMs(),
  });
  if (claimed.kind !== "claimed") return { kind: claimed.kind === "expired" ? "expired" : "stale" };
  const exchanged = await input.gateway.exchange({
    code: verdict.code,
    codeVerifier: claimed.attempt.codeVerifier,
    redirectUri: claimed.attempt.redirectUri,
    signal: input.signal,
  });
  if (exchanged.kind === "transient-failure") return { kind: "offline" };
  if (exchanged.kind === "rejected") {
    await input.repository.clearAttempt(claimed.attempt.attemptId);
    return { kind: "rejected" };
  }
  const account = await input.gateway.loadAccount(exchanged.accessToken, input.signal);
  if (account.kind === "transient-failure") return { kind: "offline" };
  if (account.kind === "revoked") {
    await input.repository.markAuthLost({
      attemptId: claimed.attempt.attemptId,
      expectedGeneration: claimed.attempt.generation,
      reason: "revoked",
    });
    return { kind: "rejected" };
  }
  const validatedAtEpochMs = input.nowEpochMs();
  const credential: KickCredential = {
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    expiresAtEpochMs: validatedAtEpochMs + exchanged.expiresInSeconds * 1_000,
    validatedAtEpochMs,
    generation: kickCredentialGeneration(claimed.attempt.generation + 1),
    scopes: exchanged.scopes,
    account: account.account,
  };
  if (
    !(await input.repository.commitConnection({
      attemptId: claimed.attempt.attemptId,
      credential,
      expectedGeneration: claimed.attempt.generation,
    }))
  )
    return { kind: "stale" };
  return {
    kind: "connected",
    credential,
    missingScopes: missingScopes(credential.scopes, input.requiredScopes),
  };
}
