import type { CapabilityManifest } from "@streamfusion/core/relay";

import type {
  CapabilityPolicyVerifier,
  InstallationCredential,
  InstallationCredentialStore,
  InstallationIdentityPresenceStore,
  InstallationIdentitySource,
  InstallationIdentityState,
  InstallationPolicyEnvironment,
  InstallationPolicyTransport,
  VerifiedPolicySnapshot,
  VerifiedPolicyStore,
} from "../capabilities/installation-policy";

export type InstallationPolicyViewModel = {
  readonly detail: string;
  readonly installation: {
    readonly detail: string;
    readonly generation: number | null;
    readonly phase: "checking" | "registered" | "retryable" | "terminal";
    readonly reconciledAt: string | null;
  };
  readonly policy: {
    readonly cacheAgeSeconds: number | null;
    readonly checkedAt: string | null;
    readonly detail: string;
    readonly effectiveSource:
      "baked-safe-fallback" | "fresh-verified" | "verified-cache";
    readonly environment: InstallationPolicyEnvironment;
    readonly expiresAt: string | null;
    readonly issuedAt: string | null;
    readonly phase: "checking" | "cached" | "safe-fallback" | "valid";
    readonly reason:
      | "cache-read"
      | "cache-write"
      | "expired"
      | "invalid"
      | "no-cache"
      | "offline"
      | "relay-unavailable"
      | "unavailable"
      | null;
    readonly sequence: number | null;
    readonly verifiedAt: string | null;
  };
  readonly refreshCapabilityPolicyEnabled: boolean;
  readonly retryInstallationRegistrationEnabled: boolean;
};

export interface InstallationPolicyRuntimeController {
  dispose(): void;
  onForeground(): void;
  refreshCapabilityPolicy(): void;
  retryInstallationRegistration(): void;
  snapshot(): InstallationPolicyViewModel;
  start(): void;
  subscribe(listener: (model: InstallationPolicyViewModel) => void): () => void;
}

export function initialInstallationPolicyViewModel(
  environment: InstallationPolicyEnvironment,
): InstallationPolicyViewModel {
  return {
  detail: "Registering this installation before checking capability policy.",
  installation: {
    detail: "Installation registration is checking.",
    generation: null,
    phase: "checking",
    reconciledAt: null,
  },
  policy: {
    cacheAgeSeconds: null,
    checkedAt: null,
    detail: "No verified policy is available yet; baked safe fallback applies.",
    effectiveSource: "baked-safe-fallback",
    environment,
    expiresAt: null,
    issuedAt: null,
    phase: "safe-fallback",
    reason: "no-cache",
    sequence: null,
    verifiedAt: null,
  },
  refreshCapabilityPolicyEnabled: false,
  retryInstallationRegistrationEnabled: false,
  };
}
const ROTATE_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1_000;

export function createInstallationPolicyRuntimeController(options: {
  readonly cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly environment: InstallationPolicyEnvironment;
  readonly identitySource: InstallationIdentitySource;
  readonly identityStore: InstallationCredentialStore;
  readonly identityPresenceStore: InstallationIdentityPresenceStore;
  readonly nowEpochMs: () => number;
  readonly isForeground?: () => boolean;
  readonly policyStore: VerifiedPolicyStore;
  readonly transport: InstallationPolicyTransport;
  readonly verifier: CapabilityPolicyVerifier;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
}): InstallationPolicyRuntimeController {
  const listeners = new Set<(model: InstallationPolicyViewModel) => void>();
  let model = initialInstallationPolicyViewModel(options.environment);
  let disposed = false;
  let inFlight = false;
  let controller: AbortController | null = null;
  let cachedSnapshot: VerifiedPolicySnapshot | null = null;
  let observedManifest: CapabilityManifest | null = null;
  let identity: InstallationIdentityState | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let attemptedExpiredSequence: number | null = null;

  const publish = (next: InstallationPolicyViewModel) => {
    if (disposed) return;
    model = next;
    listeners.forEach((listener) => listener(model));
  };

  const cachedOrFallback = (
    reason: InstallationPolicyViewModel["policy"]["reason"],
    checkedAt: string | null = model.policy.checkedAt,
  ): InstallationPolicyViewModel["policy"] => {
    if (
      cachedSnapshot !== null &&
      isUnexpired(cachedSnapshot.manifest, options.nowEpochMs())
    ) {
      return {
        cacheAgeSeconds: Math.max(
          0,
          Math.floor(
            (options.nowEpochMs() - cachedSnapshot.verifiedAtEpochMs) / 1_000,
          ),
        ),
        checkedAt,
        detail: "A verified cached policy remains effective.",
        effectiveSource: "verified-cache",
        environment: cachedSnapshot.manifest.environment,
        expiresAt: cachedSnapshot.manifest.expiresAt,
        issuedAt: cachedSnapshot.manifest.issuedAt,
        phase: "cached",
        reason,
        sequence: cachedSnapshot.manifest.sequence,
        verifiedAt: new Date(cachedSnapshot.verifiedAtEpochMs).toISOString(),
      };
    }
    return {
      cacheAgeSeconds: null,
      checkedAt,
      detail: "No verified policy is effective; baked safe fallback applies.",
      effectiveSource: "baked-safe-fallback",
      environment: options.environment,
      expiresAt: null,
      issuedAt: null,
      phase: "safe-fallback",
      reason: reason ?? "no-cache",
      sequence: null,
      verifiedAt: null,
    };
  };

  const installationStatus = (
    generation: number | null,
    phase: InstallationPolicyViewModel["installation"]["phase"],
    detail: string,
    reconciledAt: string | null = identity?.credential?.reconciledAt ?? null,
  ): InstallationPolicyViewModel["installation"] => ({
    detail,
    generation,
    phase,
    reconciledAt,
  });

  const scheduleExpiryReconciliation = (expiresAt: string | null) => {
    if (expiryTimer !== null) (options.cancel ?? clearTimeout)(expiryTimer);
    expiryTimer = null;
    if (expiresAt === null) return;
    const remainingMs = Date.parse(expiresAt) - options.nowEpochMs();
    if (remainingMs <= 0) return;
    const delayMs = Math.min(remainingMs + 1, 2_147_483_647);
    expiryTimer = (options.schedule ?? setTimeout)(() => {
      expiryTimer = null;
      if (Date.parse(expiresAt) > options.nowEpochMs()) {
        scheduleExpiryReconciliation(expiresAt);
      } else {
        expireEffectivePolicy();
      }
    }, delayMs);
  };

  const expireEffectivePolicy = () => {
    if (
      cachedSnapshot === null ||
      isUnexpired(cachedSnapshot.manifest, options.nowEpochMs())
    ) {
      return;
    }
    publish({
      detail:
        "The verified capability policy expired. Baked safe fallback now applies until a valid policy is refreshed.",
      installation: model.installation,
      policy: cachedOrFallback("expired"),
      refreshCapabilityPolicyEnabled: model.installation.phase === "registered",
      retryInstallationRegistrationEnabled:
        model.retryInstallationRegistrationEnabled,
    });
  };

  const publishFailure = (
    detail: string,
    installation: Pick<
      InstallationPolicyViewModel["installation"],
      "generation" | "phase"
    >,
    retryRegistration: boolean,
    policyFailure: Exclude<
      InstallationPolicyViewModel["policy"]["reason"],
      null
    > = "unavailable",
  ) => {
    publish({
      detail,
      installation: installationStatus(
        installation.generation,
        installation.phase,
        detail,
      ),
      policy: cachedOrFallback(policyFailure),
      refreshCapabilityPolicyEnabled: false,
      retryInstallationRegistrationEnabled: retryRegistration,
    });
  };

  async function loadCache(): Promise<void> {
    try {
      const stored = await options.policyStore.read();
      if (disposed || stored?.manifest.environment !== options.environment)
        return;
      if (
        cachedSnapshot === null ||
        stored.manifest.sequence > cachedSnapshot.manifest.sequence ||
        (stored.manifest.sequence === cachedSnapshot.manifest.sequence &&
          stored.verifiedAtEpochMs >= cachedSnapshot.verifiedAtEpochMs)
      ) {
        cachedSnapshot = stored;
        scheduleExpiryReconciliation(stored.manifest.expiresAt);
      }
      if (
        observedManifest === null ||
        stored.manifest.sequence > observedManifest.sequence
      ) {
        observedManifest = stored.manifest;
      }
      publish({
        ...model,
        policy: { ...cachedOrFallback(null), phase: "checking" },
      });
    } catch {
      // An in-memory verified candidate remains a higher monotonic floor.
    }
  }

  async function persistIdentity(
    next: InstallationIdentityState,
  ): Promise<boolean> {
    try {
      if (disposed) return false;
      await options.identityStore.write(next);
      if (disposed) return false;
      identity = next;
      return true;
    } catch {
      return false;
    }
  }

  async function persistIdentityPresence(): Promise<boolean> {
    try {
      if (disposed) return false;
      await options.identityPresenceStore.writeInitialized();
      return !disposed;
    } catch {
      return false;
    }
  }

  async function ensureRegistration(
    signal: AbortSignal,
  ): Promise<InstallationCredential | null> {
    let read;
    try {
      read = await options.identityStore.read();
      if (disposed) return null;
    } catch {
      publishFailure(
        "Installation credentials could not be read. Local Product data remains unchanged.",
        { generation: null, phase: "retryable" },
        true,
      );
      return null;
    }
    let presence;
    try {
      presence = await options.identityPresenceStore.read();
      if (disposed) return null;
    } catch {
      publishFailure(
        "Installation identity state could not be read. Product data remains unchanged.",
        { generation: null, phase: "retryable" },
        true,
      );
      return null;
    }
    if (read.kind === "corrupt") {
      publishFailure(
        "Installation credentials are unavailable. Product data was not reset.",
        { generation: null, phase: "terminal" },
        false,
      );
      return null;
    }
    if (read.kind === "empty") {
      if (presence.kind !== "absent") {
        publishFailure(
        "Installation credentials are missing. Product data was not reset.",
          { generation: null, phase: "terminal" },
          false,
        );
        return null;
      }
      identity = {
        credential: null,
        installationId: options.identitySource.create(),
        pendingRegistrationId: options.identitySource.create(),
        pendingRotationId: null,
      };
      if (!(await persistIdentity(identity))) {
        publishFailure(
          "Installation credentials could not be saved.",
          { generation: null, phase: "retryable" },
          true,
        );
        return null;
      }
    } else {
      identity = read.state;
    }
    if (identity === null) return null;
    if (presence.kind !== "initialized" && !(await persistIdentityPresence())) {
      publishFailure(
        "Installation identity could not be confirmed in Product storage.",
        {
          generation: identity.credential?.generation ?? null,
          phase: "retryable",
        },
        true,
      );
      return null;
    }
    if (
      identity.credential !== null &&
      !isExpired(identity.credential, options.nowEpochMs())
    ) {
      if (
        identity.pendingRotationId !== null ||
        Date.parse(identity.credential.credentialExpiresAt) -
          options.nowEpochMs() <=
          ROTATE_BEFORE_EXPIRY_MS
      ) {
        return rotateCredential(identity, signal);
      }
      return identity.credential;
    }
    if (identity.credential !== null && identity.pendingRotationId !== null) {
      return rotateCredential(identity, signal);
    }
    const pendingRegistrationId =
      identity.pendingRegistrationId ?? options.identitySource.create();
    if (pendingRegistrationId !== identity.pendingRegistrationId) {
      const prepared = { ...identity, pendingRegistrationId };
      if (!(await persistIdentity(prepared))) {
        publishFailure(
          "Registration could not be prepared in secure storage.",
          {
            generation: identity.credential?.generation ?? null,
            phase: "retryable",
          },
          true,
        );
        return null;
      }
    }
    if (disposed) return null;
    const registration = await options.transport.register({
      credential: identity.credential,
      environment: options.environment,
      installationId: identity.installationId,
      registrationId: pendingRegistrationId,
      signal,
    });
    if (disposed) return null;
    if (registration.kind === "failure") {
      if (registration.failure.kind === "cancelled") return null;
      const terminal = registration.failure.kind === "unauthorized";
      publishFailure(
        terminal
          ? "This installation cannot reconcile its expired credential. Product data remains unchanged."
          : "Installation registration is unavailable. Product data remains unchanged.",
        {
          generation: identity.credential?.generation ?? null,
          phase: terminal ? "terminal" : "retryable",
        },
        !terminal,
      );
      return null;
    }
    const next: InstallationIdentityState = {
      credential: registration.credential,
      installationId: identity.installationId,
      pendingRegistrationId: null,
      pendingRotationId: null,
    };
    if (!(await persistIdentity(next))) {
      publishFailure(
        "Registration completed but credentials could not be saved. Retry replays the same registration safely.",
        { generation: registration.credential.generation, phase: "retryable" },
        true,
      );
      return null;
    }
    return registration.credential;
  }

  async function rotateCredential(
    current: InstallationIdentityState,
    signal: AbortSignal,
  ): Promise<InstallationCredential | null> {
    if (current.credential === null) return null;
    const rotationId =
      current.pendingRotationId ?? options.identitySource.create();
    if (rotationId !== current.pendingRotationId) {
      const prepared = { ...current, pendingRotationId: rotationId };
      if (!(await persistIdentity(prepared))) {
        publishFailure(
          "Credential rotation could not be prepared in secure storage.",
          { generation: current.credential.generation, phase: "retryable" },
          true,
        );
        return null;
      }
    }
    if (disposed) return null;
    const rotation = await options.transport.rotate({
      credential: current.credential,
      rotationId,
      signal,
    });
    if (disposed) return null;
    if (rotation.kind === "failure") {
      if (rotation.failure.kind === "cancelled") return null;
      const terminal = rotation.failure.kind === "unauthorized";
      publishFailure(
        terminal
          ? "This installation can no longer replay its prior credential rotation. Product data remains unchanged."
          : "Credential rotation is unavailable. Existing credential remains unchanged.",
        {
          generation: current.credential.generation,
          phase: terminal ? "terminal" : "retryable",
        },
        !terminal,
      );
      return null;
    }
    const next: InstallationIdentityState = {
      credential: rotation.credential,
      installationId: current.installationId,
      pendingRegistrationId: null,
      pendingRotationId: null,
    };
    if (!(await persistIdentity(next))) {
      publishFailure(
        "Credential rotation completed but could not be saved. Retry replays the same rotation safely.",
        { generation: rotation.credential.generation, phase: "retryable" },
        true,
      );
      return null;
    }
    return rotation.credential;
  }

  async function refreshPolicy(
    credential: InstallationCredential,
    signal: AbortSignal,
  ): Promise<void> {
    const fetched = await options.transport.readManifest({
      credential,
      signal,
    });
    if (disposed) return;
    if (fetched.kind === "failure") {
      if (fetched.failure.kind === "cancelled") return;
      const reason =
        fetched.failure.kind === "offline"
          ? "offline"
          : fetched.failure.kind === "unavailable" ||
              fetched.failure.kind === "rate-limited"
            ? "relay-unavailable"
            : "unavailable";
      publish({
        detail:
          "Capability policy could not refresh. Last valid policy remains effective until it expires.",
        installation: installationStatus(
          credential.generation,
          "registered",
          "Installation credential is registered.",
          credential.reconciledAt,
        ),
        policy: cachedOrFallback(
          reason,
          new Date(options.nowEpochMs()).toISOString(),
        ),
        refreshCapabilityPolicyEnabled: true,
        retryInstallationRegistrationEnabled: false,
      });
      return;
    }
    const verified = options.verifier.verify({
      environment: options.environment,
      nowEpochMs: options.nowEpochMs(),
      payload: fetched.payload,
      previousManifest: observedManifest,
    });
    if (verified.kind === "invalid") {
      publish({
        detail: `Capability policy was rejected (${verified.reason}); valid cache, if unexpired, remains effective.`,
        installation: installationStatus(
          credential.generation,
          "registered",
          "Installation credential is registered.",
          credential.reconciledAt,
        ),
        policy: {
          ...cachedOrFallback(
            "invalid",
            new Date(options.nowEpochMs()).toISOString(),
          ),
          detail: `Capability policy was rejected (${verified.reason}); the prior effective policy remains in force.`,
          reason: "invalid",
        },
        refreshCapabilityPolicyEnabled: true,
        retryInstallationRegistrationEnabled: false,
      });
      return;
    }
    const snapshot = {
      manifest: verified.manifest,
      verifiedAtEpochMs: options.nowEpochMs(),
    };
    let persisted = false;
    try {
      persisted = await options.policyStore.write(snapshot);
    } catch {
      persisted = false;
    }
    if (disposed) return;
    observedManifest = verified.manifest;
    if (persisted) {
      cachedSnapshot = snapshot;
      attemptedExpiredSequence = null;
    }
    publish({
      detail: persisted
        ? "Capability policy signature and environment were verified; the latest valid policy is saved locally."
        : "Capability policy was verified but could not be saved, so the prior durable policy or safe fallback remains effective.",
      installation: installationStatus(
        credential.generation,
        "registered",
        "Installation credential is registered.",
        credential.reconciledAt,
      ),
      policy: persisted
        ? {
            cacheAgeSeconds: 0,
            checkedAt: new Date(options.nowEpochMs()).toISOString(),
            detail: "The signed capability policy is verified and effective.",
            effectiveSource: "fresh-verified",
            environment: verified.manifest.environment,
            expiresAt: verified.manifest.expiresAt,
            issuedAt: verified.manifest.issuedAt,
            phase: "valid",
            reason: null,
            sequence: verified.manifest.sequence,
            verifiedAt: new Date(snapshot.verifiedAtEpochMs).toISOString(),
          }
        : cachedOrFallback(
            "cache-write",
            new Date(options.nowEpochMs()).toISOString(),
          ),
      refreshCapabilityPolicyEnabled: true,
      retryInstallationRegistrationEnabled: false,
    });
    if (persisted) scheduleExpiryReconciliation(verified.manifest.expiresAt);
  }

  async function run(): Promise<void> {
    if (disposed || inFlight) return;
    inFlight = true;
    controller = new AbortController();
    publish({
      ...model,
      detail: "Checking installation credentials and capability policy.",
      installation: { ...model.installation, phase: "checking" },
      policy: { ...model.policy, phase: "checking" },
      refreshCapabilityPolicyEnabled: false,
      retryInstallationRegistrationEnabled: false,
    });
    try {
      await loadCache();
      if (disposed) return;
      const credential = await ensureRegistration(controller.signal);
      if (credential !== null && !disposed)
        await refreshPolicy(credential, controller.signal);
    } finally {
      controller = null;
      inFlight = false;
    }
  }

  return {
    dispose() {
      disposed = true;
      controller?.abort();
      if (expiryTimer !== null) (options.cancel ?? clearTimeout)(expiryTimer);
      expiryTimer = null;
      listeners.clear();
    },
    refreshCapabilityPolicy() {
      void run();
    },
    retryInstallationRegistration() {
      void run();
    },
    snapshot: () => model,
    onForeground() {
      const expiredSequence =
        cachedSnapshot !== null &&
        !isUnexpired(cachedSnapshot.manifest, options.nowEpochMs())
          ? cachedSnapshot.manifest.sequence
          : null;
      expireEffectivePolicy();
      if (
        !disposed &&
        expiredSequence !== null &&
        attemptedExpiredSequence !== expiredSequence
      ) {
        attemptedExpiredSequence = expiredSequence;
        void run();
      }
    },
    start() {
      void run();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(model);
      return () => listeners.delete(listener);
    },
  };
}

function isExpired(
  credential: InstallationCredential,
  nowEpochMs: number,
): boolean {
  return Date.parse(credential.credentialExpiresAt) <= nowEpochMs;
}

function isUnexpired(
  manifest: CapabilityManifest,
  nowEpochMs: number,
): boolean {
  return Date.parse(manifest.expiresAt) > nowEpochMs;
}
