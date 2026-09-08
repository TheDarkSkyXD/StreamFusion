import {
  missingScopes,
  twitchAttemptId,
  twitchCredentialGeneration,
  type TwitchAttemptId,
  type TwitchCancellationSignal,
  type TwitchCredential,
  type TwitchCredentialGeneration,
  type TwitchCredentialRepository,
  type TwitchDeviceAuthorizationGateway,
  type TwitchPersistedDeviceAttempt,
} from "@streamfusion/core/auth";

import {
  pollTwitchDeviceCode,
  startTwitchDeviceCode,
} from "./twitch-device-code-coordinator";
import {
  recoverInterruptedTwitchRefresh,
  refreshTwitchCredential,
} from "./twitch-refresh-coordinator";

export type TwitchAccountSessionSnapshot =
  | { readonly kind: "restoring" }
  | { readonly kind: "unavailable"; readonly guidance: string }
  | { readonly kind: "disconnected"; readonly message?: string }
  | { readonly kind: "requesting" }
  | {
      readonly kind: "pending";
      readonly code: string;
      readonly verificationUri: string;
      readonly expiresAtEpochMs: number;
      readonly status: "waiting" | "offline";
      readonly feedback?: string;
    }
  | { readonly kind: "validating" }
  | { readonly kind: "committing" }
  | {
      readonly kind: "failed";
      readonly failure: "restore" | "connection" | "cancellation";
      readonly message: string;
    }
  | {
      readonly kind: "auth-lost";
      readonly displayName: string | null;
      readonly reason: string;
    }
  | {
      readonly kind: "connected";
      readonly displayName: string;
      readonly login: string;
      readonly profileImageUrl: string | null;
      readonly scopes: readonly string[];
      readonly missingScopes: readonly string[];
      readonly expiresAtEpochMs: number;
      readonly validatedAtEpochMs: number;
      readonly refreshing: boolean;
      readonly notice?: string;
      readonly view: "summary" | "manage" | "confirm-disconnect";
    };

type CancelSignal = TwitchCancellationSignal & { cancel(): void };
type Lease = {
  readonly epoch: number;
  readonly kind: "restore" | "connect" | "poll" | "refresh" | "cancel" | "disconnect";
  readonly attemptId?: TwitchAttemptId;
  readonly generation?: TwitchCredentialGeneration;
  readonly signal: CancelSignal;
};

export interface TwitchAccountSessionController {
  cancel(): Promise<void>;
  connect(): Promise<void>;
  copyCode(): Promise<void>;
  disconnect(): Promise<void>;
  getSnapshot(): TwitchAccountSessionSnapshot;
  manage(): void;
  openVerification(): Promise<void>;
  reconcile(): Promise<void>;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  setForeground(active: boolean): void;
  subscribe(listener: () => void): () => void;
}

let operationSequence = 0;

function signal(): CancelSignal {
  let aborted = false;
  const listeners = new Set<() => void>();
  return {
    get aborted() {
      return aborted;
    },
    cancel() {
      if (aborted) return;
      aborted = true;
      for (const listener of listeners) listener();
      listeners.clear();
    },
    onCancel(listener) {
      if (aborted) {
        listener();
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createTwitchAccountSessionController(options: {
  readonly clientId: string | null;
  readonly copy: (value: string) => Promise<void>;
  readonly gateway: TwitchDeviceAuthorizationGateway | null;
  readonly now?: () => number;
  readonly open: (value: string) => Promise<void>;
  readonly repository: TwitchCredentialRepository;
}): TwitchAccountSessionController {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: TwitchAccountSessionSnapshot = { kind: "restoring" };
  let lease: Lease | null = null;
  let epoch = 0;
  let foreground = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attemptId: TwitchAttemptId | undefined;
  let generation = twitchCredentialGeneration(0);
  let readyCredential: TwitchCredential | undefined;

  const emit = (next: TwitchAccountSessionSnapshot, owner?: Lease) => {
    if (owner && !current(owner)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const invalidate = () => {
    epoch += 1;
    lease?.signal.cancel();
    lease = null;
    clearTimer();
  };
  const begin = (
    kind: Lease["kind"],
    identity: Pick<Lease, "attemptId" | "generation"> = {},
  ) => {
    invalidate();
    const next: Lease = { epoch, kind, signal: signal(), ...identity };
    lease = next;
    return next;
  };
  const current = (owner: Lease) =>
    foreground && lease === owner && owner.epoch === epoch && !owner.signal.aborted;
  const projectCredential = (
    credential: TwitchCredential,
    owner: Lease,
    notice?: string,
  ) => {
    if (credential.expiresAtEpochMs <= now()) {
      fail(
        "restore",
        "Twitch access has expired. Retry loading account state to refresh safely.",
        owner,
      );
      return;
    }
    generation = credential.generation;
    readyCredential = credential;
    emit(
      {
        kind: "connected",
        displayName: credential.account.displayName,
        login: credential.account.login,
        profileImageUrl: credential.account.profileImageUrl,
        scopes: credential.scopes,
        missingScopes: missingScopes(credential.scopes, ["chat:read"]),
        expiresAtEpochMs: credential.expiresAtEpochMs,
        validatedAtEpochMs: credential.validatedAtEpochMs,
        refreshing: false,
        ...(notice ? { notice } : {}),
        view: "summary",
      },
      owner,
    );
    clearTimer();
    timer = setTimeout(
      () => {
        if (current(owner)) void reconcile();
      },
      Math.max(0, Math.min(60 * 60 * 1_000, credential.expiresAtEpochMs - now())),
    );
  };
  const fail = (
    failure: Extract<TwitchAccountSessionSnapshot, { kind: "failed" }>["failure"],
    message: string,
    owner: Lease,
  ) => emit({ kind: "failed", failure, message }, owner);

  const schedulePoll = (owner: Lease, id: TwitchAttemptId, at: number) => {
    clearTimer();
    timer = setTimeout(() => void poll(owner, id), Math.max(0, at - now()));
  };

  const emitPending = (
    owner: Lease,
    attempt: TwitchPersistedDeviceAttempt,
    status: "offline" | "waiting",
  ) => {
    const feedback =
      owner.attemptId === attempt.attemptId &&
      snapshot.kind === "pending" &&
      snapshot.code === attempt.userCode
        ? snapshot.feedback
        : undefined;
    emit(
      {
        kind: "pending",
        code: attempt.userCode,
        verificationUri: attempt.verificationUri,
        expiresAtEpochMs: attempt.expiresAtEpochMs,
        status,
        ...(feedback ? { feedback } : {}),
      },
      owner,
    );
  };

  const poll = async (owner: Lease, id: TwitchAttemptId) => {
    if (!current(owner) || !options.gateway || !options.clientId) return;
    try {
      const result = await pollTwitchDeviceCode({
        repository: options.repository,
        gateway: options.gateway,
        attemptId: id,
        expectedClientId: options.clientId,
        requiredScopes: ["chat:read"],
        nowEpochMs: now,
        signal: owner.signal,
        onProgress: (phase) => emit({ kind: phase }, owner),
      });
      if (!current(owner)) return;
      if (result.kind === "pending") {
        const durable = await options.repository.read();
        if (!current(owner)) return;
        if (
          durable.kind !== "connecting" &&
          durable.kind !== "poll-in-flight"
        ) {
          await reconcile();
          return;
        }
        emitPending(owner, durable.attempt, result.status);
        schedulePoll(owner, id, result.nextPollAtEpochMs);
        return;
      }
      if (result.kind === "connected" || result.kind === "reconnect-required") {
        await reconcile();
        return;
      }
      fail(
        "connection",
        result.kind === "denied"
          ? "Twitch denied this connection."
          : result.kind === "expired"
            ? "The Device Code expired."
            : "This connection attempt was superseded.",
        owner,
      );
    } catch {
      if (!current(owner)) return;
      try {
        const durable = await options.repository.read();
        if (!current(owner)) return;
        if (
          durable.kind === "ready" ||
          durable.kind === "auth-lost" ||
          durable.kind === "disconnected"
        ) {
          await reconcile();
          return;
        }
        if (
          (durable.kind === "connecting" || durable.kind === "poll-in-flight") &&
          durable.attempt.attemptId === id
        ) {
          if (snapshot.kind === "validating" || snapshot.kind === "committing") {
            const cleared = await options.repository.clearAttempt(id);
            if (!current(owner)) return;
            if (!cleared) {
              await reconcile();
              return;
            }
            fail(
              "connection",
              "Twitch authorization could not be committed safely. Restart connection with a new Device Code.",
              owner,
            );
            return;
          }
          emitPending(owner, durable.attempt, "offline");
          schedulePoll(owner, id, durable.attempt.nextPollAtEpochMs);
        }
      } catch {
        fail("restore", "Account state could not be reconciled after the network failure.", owner);
      }
    }
  };

  const validateReady = async (credential: TwitchCredential, owner: Lease) => {
    if (!options.gateway || !options.clientId) {
      emit(
        {
          kind: "unavailable",
          guidance: "A qualified public Twitch client ID is required. The encrypted credential remains preserved.",
        },
        owner,
      );
      return;
    }
    if (credential.expiresAtEpochMs <= now()) {
      await refreshWithLease(owner, credential.generation, "Cached access expired; refreshing safely.");
      return;
    }
    emit({ kind: "validating" }, owner);
    const validation = await options.gateway.validate(credential.accessToken, owner.signal);
    if (!current(owner)) return;
    if (validation.kind === "transient-failure") {
      if (credential.expiresAtEpochMs <= now()) {
        await refreshWithLease(
          owner,
          credential.generation,
          "Access expired while Twitch was offline. Retry loading account state to refresh safely.",
        );
        return;
      }
      projectCredential(
        credential,
        owner,
        "Validation is offline. Showing the last verified, unexpired account state.",
      );
      return;
    }
    if (
      validation.kind === "valid" &&
      validation.validation.clientId === options.clientId &&
      validation.validation.userId === credential.account.id &&
      validation.validation.expiresInSeconds <= 0
    ) {
      await refreshWithLease(
        owner,
        credential.generation,
        "Twitch access expired while refresh was unavailable. Retry loading account state.",
      );
      return;
    }
    if (
      validation.kind === "revoked" ||
      validation.validation.clientId !== options.clientId ||
      validation.validation.userId !== credential.account.id
    ) {
      const saved = await options.repository.markAuthLost({
        expectedGeneration: credential.generation,
        reason: "revoked",
      });
      if (!current(owner)) return;
      if (!saved) {
        const durable = await options.repository.read();
        if (!current(owner)) return;
        if (durable.kind !== "auth-lost") {
          fail("restore", "Invalid Twitch identity was detected, but the fenced auth-loss update was superseded. Reload account state.", owner);
          return;
        }
      }
      await reconcile();
      return;
    }
    const validatedAtEpochMs = now();
    const expiresAtEpochMs =
      validatedAtEpochMs + validation.validation.expiresInSeconds * 1_000;
    if (expiresAtEpochMs <= validatedAtEpochMs) {
      fail("restore", "Twitch returned an invalid access expiry. Retry account validation.", owner);
      return;
    }
    emit({ kind: "committing" }, owner);
    const committed = await options.repository.commitValidation({
      accountId: credential.account.id,
      expectedGeneration: credential.generation,
      expiresAtEpochMs,
      scopes: validation.validation.scopes,
      validatedAtEpochMs,
    });
    if (!current(owner)) return;
    if (!committed) {
      const durable = await options.repository.read();
      if (!current(owner)) return;
      if (
        durable.kind === "ready" &&
        durable.credential.generation === credential.generation &&
        durable.credential.account.id === credential.account.id &&
        durable.credential.validatedAtEpochMs >= validatedAtEpochMs
      ) {
        projectCredential(durable.credential, owner);
        return;
      }
      if (
        durable.kind === "ready" &&
        durable.credential.generation === credential.generation
      ) {
        fail("restore", "Validated Twitch metadata could not be committed. Retry loading account state.", owner);
        return;
      }
      await reconcile();
      return;
    }
    const reread = await options.repository.read();
    if (!current(owner)) return;
    if (reread.kind === "ready") projectCredential(reread.credential, owner);
    else await reconcile();
  };

  const reconcile = async () => {
    if (!foreground) return;
    const owner = begin("restore");
    emit({ kind: "restoring" }, owner);
    try {
      const durable = await options.repository.read();
      if (!current(owner)) return;
      if (durable.kind === "disconnected") {
        generation = durable.generation;
        emit(
          options.gateway
            ? { kind: "disconnected" }
            : {
                kind: "unavailable",
                guidance: "A qualified public Twitch client ID is required before connection can start. Guest mode remains available.",
              },
          owner,
        );
        return;
      }
      if (durable.kind === "requesting") {
        const cleared = await options.repository.clearAttempt(durable.attemptId);
        if (!current(owner)) return;
        if (!cleared) {
          fail("restore", "The interrupted code request could not be cleared. Retry loading account state.", owner);
          return;
        }
        await reconcile();
        return;
      }
      if (durable.kind === "connecting" || durable.kind === "poll-in-flight") {
        attemptId = durable.attempt.attemptId;
        generation = durable.attempt.generation;
        const pollOwner = begin("poll", { attemptId, generation });
        emit(
          {
            kind: "pending",
            code: durable.attempt.userCode,
            verificationUri: durable.attempt.verificationUri,
            expiresAtEpochMs: durable.attempt.expiresAtEpochMs,
            status: "waiting",
          },
          pollOwner,
        );
        schedulePoll(pollOwner, attemptId, durable.attempt.nextPollAtEpochMs);
        return;
      }
      if (durable.kind === "refresh-in-flight") {
        const recovered = await recoverInterruptedTwitchRefresh(options.repository);
        if (!current(owner)) return;
        if (recovered !== "recovered") {
          fail("restore", "Interrupted refresh recovery could not be confirmed.", owner);
          return;
        }
        await reconcile();
        return;
      }
      if (durable.kind === "auth-lost") {
        generation = durable.generation;
        emit(
          {
            kind: "auth-lost",
            displayName: durable.account?.displayName ?? null,
            reason: durable.reason,
          },
          owner,
        );
        return;
      }
      generation = durable.credential.generation;
      await validateReady(durable.credential, owner);
    } catch {
      fail("restore", "Encrypted account state could not be loaded or validated. Retry loading account state.", owner);
    }
  };

  const refreshWithLease = async (
    owner: Lease,
    expectedGeneration: TwitchCredentialGeneration,
    offlineMessage: string,
  ) => {
    if (!options.gateway || !options.clientId) return;
    const result = await refreshTwitchCredential({
      repository: options.repository,
      gateway: options.gateway,
      expectedClientId: options.clientId,
      expectedGeneration,
      operationId: `mobile-refresh-${now()}-${++operationSequence}`,
      nowEpochMs: now,
      signal: owner.signal,
    });
    if (!current(owner)) return;
    if (result.kind === "transient-failure") {
      fail("restore", offlineMessage, owner);
      return;
    }
    await reconcile();
  };

  const connect = async () => {
    if (!foreground || !options.gateway) return;
    const owner = begin("connect", { generation });
    const id = twitchAttemptId(`mobile-${now()}-${++operationSequence}`);
    attemptId = id;
    emit({ kind: "requesting" }, owner);
    try {
      const result = await startTwitchDeviceCode({
        repository: options.repository,
        gateway: options.gateway,
        attemptId: id,
        expectedGeneration: generation,
        scopes: ["chat:read"],
        nowEpochMs: now,
        signal: owner.signal,
      });
      if (!current(owner)) return;
      if (result.kind === "stale") {
        await reconcile();
        return;
      }
      const pollOwner = begin("poll", { attemptId: id, generation });
      emit(
        {
          kind: "pending",
          code: result.attempt.userCode,
          verificationUri: result.attempt.verificationUri,
          expiresAtEpochMs: result.attempt.expiresAtEpochMs,
          status: "waiting",
        },
        pollOwner,
      );
      schedulePoll(pollOwner, id, result.attempt.nextPollAtEpochMs);
    } catch {
      fail("connection", "Twitch is unavailable. Check your connection and retry.", owner);
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setForeground(active) {
      if (active === foreground) return;
      foreground = active;
      invalidate();
      if (active) void reconcile();
    },
    reconcile,
    connect,
    async cancel() {
      if (!attemptId) return;
      const target = attemptId;
      const owner = begin("cancel", { attemptId: target, generation });
      try {
        const cleared = await options.repository.clearAttempt(target);
        if (!current(owner)) return;
        if (!cleared) {
          fail("cancellation", "Cancellation could not be confirmed. Retry cancellation or reload account state.", owner);
          return;
        }
        attemptId = undefined;
        await reconcile();
      } catch {
        fail("cancellation", "Cancellation failed. The connection attempt may still be active.", owner);
      }
    },
    async copyCode() {
      if (snapshot.kind !== "pending" || !attemptId) return;
      const owner = lease;
      const target = attemptId;
      const code = snapshot.code;
      if (!owner) return;
      try {
        await options.copy(code);
        if (current(owner) && attemptId === target && snapshot.kind === "pending")
          emit({ ...snapshot, feedback: "Code copied." }, owner);
      } catch {
        if (current(owner) && attemptId === target && snapshot.kind === "pending")
          emit({ ...snapshot, feedback: "Code could not be copied." }, owner);
      }
    },
    async openVerification() {
      if (snapshot.kind !== "pending" || !attemptId) return;
      const owner = lease;
      const target = attemptId;
      const uri = snapshot.verificationUri;
      if (!owner) return;
      try {
        await options.open(uri);
      } catch {
        if (current(owner) && attemptId === target && snapshot.kind === "pending")
          emit({ ...snapshot, feedback: "The verification page could not be opened." }, owner);
      }
    },
    manage() {
      if (snapshot.kind !== "connected") return;
      snapshot = {
        ...snapshot,
        view: snapshot.view === "summary" ? "manage" : "summary",
      };
      for (const listener of listeners) listener();
    },
    async disconnect() {
      if (snapshot.kind !== "connected") return;
      if (snapshot.refreshing) return;
      if (snapshot.view !== "confirm-disconnect") {
        emit({ ...snapshot, view: "confirm-disconnect" });
        return;
      }
      const owner = begin("disconnect", { generation });
      emit({ ...snapshot, refreshing: true }, owner);
      try {
        const disconnected = await options.repository.disconnect(generation);
        if (!current(owner)) return;
        if (!disconnected) {
          fail("restore", "Disconnect was superseded. Reload account state.", owner);
          return;
        }
        await reconcile();
      } catch {
        if (current(owner)) await reconcile();
      }
    },
    async refresh() {
      if (snapshot.kind !== "connected" || snapshot.refreshing || !readyCredential)
        return;
      const fallback = readyCredential;
      const owner = begin("refresh", { generation });
      emit({ ...snapshot, refreshing: true }, owner);
      try {
        if (!options.gateway || !options.clientId) return;
        const result = await refreshTwitchCredential({
          repository: options.repository,
          gateway: options.gateway,
          expectedClientId: options.clientId,
          expectedGeneration: generation,
          operationId: `mobile-refresh-${now()}-${++operationSequence}`,
          nowEpochMs: now,
          signal: owner.signal,
        });
        if (!current(owner)) return;
        if (result.kind === "transient-failure") {
          projectCredential(
            fallback,
            owner,
            "Refresh is temporarily unavailable. The current encrypted account remains connected.",
          );
          return;
        }
        await reconcile();
      } catch {
        if (current(owner)) await reconcile();
      }
    },
    async retry() {
      if (snapshot.kind === "auth-lost") await connect();
      else if (snapshot.kind === "failed" && snapshot.failure === "connection")
        await connect();
      else if (snapshot.kind === "failed" && snapshot.failure === "cancellation")
        await this.cancel();
      else await reconcile();
    },
  };
}
