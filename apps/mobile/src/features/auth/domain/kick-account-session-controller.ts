import {
  KICK_APP_SCOPES,
  kickAttemptId,
  kickCredentialGeneration,
  missingScopes,
  type KickAttemptId,
  type KickAuthorizationGateway,
  type KickCallbackInput,
  type KickCancellationSignal,
  type KickCredential,
  type KickCredentialGeneration,
  type KickCredentialRepository,
} from "@streamfusion/core/auth";

import type {
  KickCallbackSource,
  KickFixtureCallbackKind,
  KickFixtureInjector,
} from "@mobile/features/auth/capabilities/kick-session";
import {
  completeKickAuthorization,
  startKickAuthorization,
} from "./kick-pkce-coordinator";
import {
  recoverInterruptedKickRefresh,
  refreshKickCredential,
} from "./kick-refresh-coordinator";

export type KickAccountSessionSnapshot =
  | { readonly kind: "restoring" }
  | { readonly kind: "unavailable"; readonly guidance: string }
  | { readonly kind: "disconnected"; readonly message?: string }
  | { readonly kind: "launching" }
  | { readonly kind: "pending"; readonly expiresAtEpochMs: number }
  | { readonly kind: "validating" | "committing" }
  | {
      readonly kind: "failed";
      readonly failure: "restore" | "connection" | "cancellation";
      readonly message: string;
    }
  | { readonly kind: "auth-lost"; readonly displayName: string | null; readonly reason: string }
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

type CancelSignal = KickCancellationSignal & { cancel(): void };
type Lease = {
  readonly epoch: number;
  readonly kind: "restore" | "connect" | "callback" | "refresh" | "cancel" | "disconnect";
  readonly attemptId?: KickAttemptId;
  readonly generation?: KickCredentialGeneration;
  readonly signal: CancelSignal;
};

export interface KickAccountSessionController {
  cancel(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getSnapshot(): KickAccountSessionSnapshot;
  injectFixture?(kind: KickFixtureCallbackKind): Promise<void>;
  manage(): void;
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

const failureMessage: Record<
  Exclude<Awaited<ReturnType<typeof completeKickAuthorization>>["kind"], "connected">,
  string
> = {
  denied: "Kick denied this connection.",
  expired: "The Kick authorization attempt expired.",
  stale: "No Kick authorization was waiting for this return.",
  duplicate: "This Kick authorization was already used.",
  "state-mismatch": "Kick returned an unexpected authorization state.",
  "wrong-redirect": "Kick returned to an unexpected callback address.",
  superseded: "A newer Kick authorization replaced this return.",
  offline: "Kick is unavailable. Check your connection and retry.",
  rejected: "Kick rejected the authorization code.",
};

export function createKickAccountSessionController(options: {
  readonly authorize: (input: {
    readonly clientId: string;
    readonly nowEpochMs: number;
  }) => Promise<{
    readonly authorizeUrl: string;
    readonly codeVerifier: string;
    readonly expiresAtEpochMs: number;
    readonly redirectUri: string;
    readonly state: string;
  }>;
  readonly callbacks: KickCallbackSource;
  readonly clientId: string | null;
  readonly fixture?: KickFixtureInjector;
  readonly gateway: KickAuthorizationGateway | null;
  readonly now?: () => number;
  readonly open: (value: string) => Promise<void>;
  readonly repository: KickCredentialRepository;
}): KickAccountSessionController {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: KickAccountSessionSnapshot = { kind: "restoring" };
  let lease: Lease | null = null;
  let epoch = 0;
  let foreground = false;
  let attemptId: KickAttemptId | undefined;
  let generation = kickCredentialGeneration(0);
  let readyCredential: KickCredential | undefined;
  let liveState: string | undefined;
  let consumed: { readonly attemptId: KickAttemptId; readonly state: string } | null = null;
  const replacedAttempts: { attemptId: KickAttemptId; state: string }[] = [];
  const emit = (next: KickAccountSessionSnapshot, owner?: Lease) => {
    if (owner && (lease !== owner || owner.epoch !== epoch || owner.signal.aborted)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const invalidate = () => {
    epoch += 1;
    lease?.signal.cancel();
    lease = null;
  };
  const begin = (kind: Lease["kind"], identity: Pick<Lease, "attemptId" | "generation"> = {}) => {
    invalidate();
    const next: Lease = { epoch, kind, signal: signal(), ...identity };
    lease = next;
    return next;
  };
  const current = (owner: Lease) =>
    foreground && lease === owner && owner.epoch === epoch && !owner.signal.aborted;
  const fail = (
    failure: Extract<KickAccountSessionSnapshot, { kind: "failed" }>["failure"],
    message: string,
    owner: Lease,
  ) => emit({ kind: "failed", failure, message }, owner);
  const projectCredential = (credential: KickCredential, owner: Lease, notice?: string) => {
    generation = credential.generation;
    readyCredential = credential;
    emit(
      {
        kind: "connected",
        displayName: credential.account.displayName,
        login: credential.account.login,
        profileImageUrl: credential.account.profileImageUrl,
        scopes: credential.scopes,
        missingScopes: missingScopes(credential.scopes, KICK_APP_SCOPES),
        expiresAtEpochMs: credential.expiresAtEpochMs,
        validatedAtEpochMs: credential.validatedAtEpochMs,
        refreshing: false,
        ...(notice ? { notice } : {}),
        view: "summary",
      },
      owner,
    );
  };

  const handleCallback = async (callback: KickCallbackInput) => {
    if (!foreground || !options.gateway) return;
    const owner = begin("callback", {
      ...(attemptId ? { attemptId } : {}),
      generation,
    });
    emit({ kind: "validating" }, owner);
    const result = await completeKickAuthorization({
      callback,
      consumed,
      gateway: options.gateway,
      nowEpochMs: now,
      replacedAttempts,
      requiredScopes: KICK_APP_SCOPES,
      repository: options.repository,
      signal: owner.signal,
    });
    if (!current(owner)) return;
    if (result.kind === "connected") {
      consumed = liveState && attemptId ? { attemptId, state: liveState } : consumed;
      liveState = undefined;
      attemptId = undefined;
      emit({ kind: "committing" }, owner);
      projectCredential(result.credential, owner);
      return;
    }
    fail("connection", failureMessage[result.kind], owner);
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
                guidance:
                  "A qualified public Kick client ID is required before connection can start. Guest mode remains available.",
              },
          owner,
        );
        return;
      }
      if (durable.kind === "launching" || durable.kind === "pending" || durable.kind === "exchanging") {
        attemptId = durable.attempt.attemptId;
        generation = durable.attempt.generation;
        liveState = durable.attempt.state;
        emit({ kind: "pending", expiresAtEpochMs: durable.attempt.expiresAtEpochMs }, owner);
        return;
      }
      if (durable.kind === "refresh-in-flight") {
        const recovered = await recoverInterruptedKickRefresh(options.repository);
        if (!current(owner)) return;
        if (recovered !== "recovered") {
          fail("restore", "Interrupted Kick refresh recovery could not be confirmed.", owner);
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
      if (durable.kind === "ready") projectCredential(durable.credential, owner);
    } catch {
      fail("restore", "Encrypted Kick account state could not be loaded. Retry loading account state.", owner);
    }
  };

  const connect = async () => {
    if (!foreground || !options.gateway || !options.clientId) return;
    if (liveState && attemptId)
      replacedAttempts.push({ attemptId, state: liveState });
    const owner = begin("connect", { generation });
    const id = kickAttemptId(`mobile-kick-${now()}-${++operationSequence}`);
    attemptId = id;
    emit({ kind: "launching" }, owner);
    try {
      const authorization = await options.authorize({
        clientId: options.clientId,
        nowEpochMs: now(),
      });
      const started = await startKickAuthorization({
        attempt: {
          attemptId: id,
          codeVerifier: authorization.codeVerifier,
          expiresAtEpochMs: authorization.expiresAtEpochMs,
          generation,
          redirectUri: authorization.redirectUri,
          state: authorization.state,
        },
        expectedGeneration: generation,
        repository: options.repository,
      });
      if (!current(owner)) return;
      if (started === "stale") {
        await reconcile();
        return;
      }
      liveState = authorization.state;
      emit({ kind: "pending", expiresAtEpochMs: authorization.expiresAtEpochMs }, owner);
      try {
        await options.open(authorization.authorizeUrl);
      } catch {
        if (current(owner))
          emit({ kind: "pending", expiresAtEpochMs: authorization.expiresAtEpochMs }, owner);
      }
    } catch {
      fail("connection", "Kick is unavailable. Check your connection and retry.", owner);
    }
  };

  options.callbacks.subscribe((input) => {
    void handleCallback(input);
  });

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
        liveState = undefined;
        await reconcile();
      } catch {
        fail("cancellation", "Cancellation failed. The Kick connection attempt may still be active.", owner);
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
      if (snapshot.kind !== "connected" || snapshot.refreshing) return;
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
        readyCredential = undefined;
        await reconcile();
      } catch {
        if (current(owner)) await reconcile();
      }
    },
    async refresh() {
      if (snapshot.kind !== "connected" || snapshot.refreshing || !readyCredential) return;
      const fallback = readyCredential;
      const owner = begin("refresh", { generation });
      emit({ ...snapshot, refreshing: true }, owner);
      try {
        if (!options.gateway) return;
        const result = await refreshKickCredential({
          repository: options.repository,
          gateway: options.gateway,
          expectedGeneration: generation,
          operationId: `mobile-kick-refresh-${now()}-${++operationSequence}`,
          nowEpochMs: now,
          signal: owner.signal,
        });
        if (!current(owner)) return;
        if (result.kind === "transient-failure") {
          projectCredential(
            fallback,
            owner,
            "Refresh is temporarily unavailable. The current encrypted Kick account remains connected.",
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
      else if (snapshot.kind === "failed" && snapshot.failure === "connection") await connect();
      else if (snapshot.kind === "failed" && snapshot.failure === "cancellation") await this.cancel();
      else await reconcile();
    },
    ...(options.fixture
      ? {
          async injectFixture(kind: KickFixtureCallbackKind) {
            if (kind === "stale") {
              if (attemptId) await options.repository.clearAttempt(attemptId);
              attemptId = undefined;
              liveState = undefined;
            }
            if (kind === "superseded" && attemptId && liveState)
              replacedAttempts.push({ attemptId, state: liveState });
            if (kind === "duplicate" && attemptId && liveState)
              consumed = { attemptId, state: liveState };
            await handleCallback(
              options.fixture!.inject(kind, liveState ? { state: liveState } : null),
            );
          },
        }
      : {}),
  };
}
