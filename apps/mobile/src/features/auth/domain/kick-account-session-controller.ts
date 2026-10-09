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

type CancelSignal = KickCancellationSignal & { cancel(): void };
type Lease = {
  readonly epoch: number;
  readonly kind:
    "restore" | "connect" | "callback" | "refresh" | "cancel" | "disconnect";
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
  Exclude<
    Awaited<ReturnType<typeof completeKickAuthorization>>["kind"],
    "connected"
  >,
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
  "account-unavailable":
    "Kick account lookup is unavailable. Retry the connection.",
  rejected: "Kick rejected the authorization code.",
};

export function createKickAccountSessionController(options: {
  readonly authorize: (input: { readonly nowEpochMs: number }) => Promise<{
    readonly authorizeUrl: string;
    readonly codeVerifier: string;
    readonly expiresAtEpochMs: number;
    readonly redirectUri: string;
    readonly state: string;
  }>;
  readonly callbacks: KickCallbackSource;
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
  let consumed: {
    readonly attemptId: KickAttemptId;
    readonly state: string;
  } | null = null;
  const replacedAttempts: { attemptId: KickAttemptId; state: string }[] = [];
  const callbackInbox: KickCallbackInput[] = [];
  let callbackBusy = false;
  const emit = (next: KickAccountSessionSnapshot, owner?: Lease) => {
    if (
      owner &&
      (lease !== owner || owner.epoch !== epoch || owner.signal.aborted)
    )
      return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const invalidate = () => {
    epoch += 1;
    lease?.signal.cancel();
    lease = null;
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
    foreground &&
    lease === owner &&
    owner.epoch === epoch &&
    !owner.signal.aborted;
  const fail = (
    failure: Extract<KickAccountSessionSnapshot, { kind: "failed" }>["failure"],
    message: string,
    owner: Lease,
  ) => emit({ kind: "failed", failure, message }, owner);
  const projectCredential = (
    credential: KickCredential,
    owner: Lease,
    notice?: string,
  ) => {
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

  const handleCallback = async () => {
    if (
      callbackBusy ||
      !foreground ||
      !options.gateway ||
      !liveState ||
      !attemptId
    )
      return;
    const index = callbackInbox.findIndex((input) => input.state === liveState);
    const callback = callbackInbox[index];
    if (!callback) return;
    callbackBusy = true;
    const owner = begin("callback", {
      ...(attemptId ? { attemptId } : {}),
      generation,
    });
    emit({ kind: "validating" }, owner);
    try {
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
      callbackInbox.splice(index, 1);
      if (result.kind === "connected") {
        consumed =
          liveState && attemptId ? { attemptId, state: liveState } : consumed;
        liveState = undefined;
        attemptId = undefined;
        callbackInbox.length = 0;
        emit({ kind: "committing" }, owner);
        projectCredential(result.credential, owner);
        return;
      }
      if (result.kind === "offline") callbackInbox.unshift(callback);
      if (
        ["denied", "expired", "rejected", "account-unavailable"].includes(
          result.kind,
        ) &&
        attemptId
      ) {
        await options.repository.clearAttempt(attemptId);
        attemptId = undefined;
        liveState = undefined;
      }
      fail("connection", failureMessage[result.kind], owner);
    } catch {
      if (current(owner))
        fail(
          "connection",
          "Kick is unavailable. Check your connection and retry.",
          owner,
        );
    } finally {
      callbackBusy = false;
      if (
        foreground &&
        snapshot.kind === "pending" &&
        callbackInbox.some((input) => input.state === liveState)
      )
        void reconcile();
    }
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
        attemptId = undefined;
        liveState = undefined;
        emit(
          options.gateway
            ? { kind: "disconnected" }
            : {
                kind: "unavailable",
                guidance:
                  "Kick sign-in is unavailable in this build. You can still browse, watch, and follow channels in guest mode.",
              },
          owner,
        );
        return;
      }
      if (
        durable.kind === "launching" ||
        durable.kind === "pending" ||
        durable.kind === "exchanging"
      ) {
        attemptId = durable.attempt.attemptId;
        generation = durable.attempt.generation;
        liveState = durable.attempt.state;
        for (let index = callbackInbox.length - 1; index >= 0; index -= 1)
          if (callbackInbox[index]?.state !== liveState)
            callbackInbox.splice(index, 1);
        emit(
          {
            kind: "pending",
            expiresAtEpochMs: durable.attempt.expiresAtEpochMs,
          },
          owner,
        );
        void handleCallback();
        return;
      }
      if (durable.kind === "refresh-in-flight") {
        const recovered = await recoverInterruptedKickRefresh(
          options.repository,
        );
        if (!current(owner)) return;
        if (recovered !== "recovered") {
          fail(
            "restore",
            "Interrupted Kick refresh recovery could not be confirmed.",
            owner,
          );
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
      if (durable.kind === "ready") {
        callbackInbox.length = 0;
        projectCredential(durable.credential, owner);
      }
    } catch {
      fail(
        "restore",
        "Encrypted Kick account state could not be loaded. Retry loading account state.",
        owner,
      );
    }
  };

  const connect = async () => {
    if (!foreground || !options.gateway) return;
    const previous =
      liveState && attemptId ? { attemptId, state: liveState } : null;
    const owner = begin("connect", { generation });
    callbackInbox.length = 0;
    const id = kickAttemptId(`mobile-kick-${now()}-${++operationSequence}`);
    attemptId = id;
    emit({ kind: "launching" }, owner);
    try {
      const authorization = await options.authorize({
        nowEpochMs: now(),
      });
      if (!current(owner)) return;
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
      if (!current(owner)) {
        await options.repository.clearAttempt(id);
        return;
      }
      if (started === "stale") {
        await reconcile();
        return;
      }
      if (previous) replacedAttempts.push(previous);
      liveState = authorization.state;
      emit(
        { kind: "pending", expiresAtEpochMs: authorization.expiresAtEpochMs },
        owner,
      );
      void handleCallback();
      try {
        await options.open(authorization.authorizeUrl);
      } catch {
        if (current(owner))
          fail(
            "connection",
            "The Kick browser could not be opened. Retry the connection.",
            owner,
          );
      }
    } catch {
      fail(
        "connection",
        "Kick is unavailable. Check your connection and retry.",
        owner,
      );
    }
  };

  options.callbacks.subscribe((input) => {
    if (
      !callbackInbox.some(
        (queued) =>
          queued.state === input.state &&
          queued.code === input.code &&
          queued.error === input.error,
      )
    )
      callbackInbox.push(input);
    if (callbackInbox.length > 8) callbackInbox.shift();
    void handleCallback();
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
      if (callbackBusy && lease?.kind === "callback") return;
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
          fail(
            "cancellation",
            "Cancellation could not be confirmed. Retry cancellation or reload account state.",
            owner,
          );
          return;
        }
        attemptId = undefined;
        liveState = undefined;
        callbackInbox.length = 0;
        await reconcile();
      } catch {
        fail(
          "cancellation",
          "Cancellation failed. The Kick connection attempt may still be active.",
          owner,
        );
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
          fail(
            "restore",
            "Disconnect was superseded. Reload account state.",
            owner,
          );
          return;
        }
        readyCredential = undefined;
        await reconcile();
      } catch {
        if (current(owner)) await reconcile();
      }
    },
    async refresh() {
      if (
        snapshot.kind !== "connected" ||
        snapshot.refreshing ||
        !readyCredential
      )
        return;
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
      else if (
        snapshot.kind === "failed" &&
        snapshot.failure === "connection"
      ) {
        if (callbackInbox.some((input) => input.state === liveState)) {
          await reconcile();
          await handleCallback();
        } else await connect();
      } else if (
        snapshot.kind === "failed" &&
        snapshot.failure === "cancellation"
      )
        await this.cancel();
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
            const callback = options.fixture!.inject(
              kind,
              liveState ? { state: liveState } : null,
            );
            callbackInbox.push(callback);
            await handleCallback();
          },
        }
      : {}),
  };
}
