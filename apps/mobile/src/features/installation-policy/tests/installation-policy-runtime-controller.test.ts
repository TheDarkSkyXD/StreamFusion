import { describe, expect, it } from "vitest";

import {
  createInstallationPolicyRuntimeController,
  type InstallationPolicyViewModel,
} from "../domain/installation-policy-runtime-controller";
import { createSecureInstallationIdentityStore } from "../data/secure-installation-identity-store";
import type {
  InstallationIdentityReadResult,
  InstallationIdentityState,
} from "../capabilities/installation-policy";

const manifest = {
  capabilities: [],
  environment: "development" as const,
  expiresAt: "2026-10-01T00:00:00.000Z",
  issuedAt: "2026-09-01T00:00:00.000Z",
  schemaVersion: 1 as const,
  sequence: 4,
};
const credential = {
  credential: `v1.${"A".repeat(43)}.${"B".repeat(43)}`,
  credentialExpiresAt: "2026-09-20T00:00:00.000Z",
  generation: 1,
  installationId: "de3c0860-7340-4f2d-b7bb-bc091f9150b0",
  reconciledAt: "2026-09-07T00:00:00.000Z",
};

function waitFor(
  controller: ReturnType<typeof createInstallationPolicyRuntimeController>,
  predicate: (model: InstallationPolicyViewModel) => boolean,
): Promise<InstallationPolicyViewModel> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    unsubscribe = controller.subscribe((model) => {
      if (!predicate(model)) return;
      settled = true;
      unsubscribe();
      resolve(model);
    });
    if (settled) unsubscribe();
  });
}

function createIdentityPresenceStore() {
  return {
    async read() {
      return { kind: "absent" as const };
    },
    async writeInitialized() {},
  };
}

function createController(input: {
  readonly identityRead: InstallationIdentityReadResult;
  readonly fetch: "failure" | "received";
  readonly verifier: "invalid" | "valid";
  readonly storedSnapshot?: {
    readonly manifest: typeof manifest;
    readonly verifiedAtEpochMs: number;
  } | null;
}) {
  let identityRead = input.identityRead;
  const writes: InstallationIdentityState[] = [];
  const controller = createInstallationPolicyRuntimeController({
    environment: "development",
    identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
    identityPresenceStore: createIdentityPresenceStore(),
    identityStore: {
      async read() {
        return identityRead;
      },
      async write(state) {
        writes.push(state);
        identityRead = { kind: "ready", state };
      },
    },
    nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
    policyStore: {
      async read() {
        return input.storedSnapshot ?? null;
      },
      async write() {
        return true;
      },
    },
    transport: {
      async readManifest() {
        return input.fetch === "received"
          ? { kind: "received", payload: { signed: "candidate" } }
          : { kind: "failure", failure: { kind: "unavailable" } };
      },
      async register() {
        return { kind: "registered", credential };
      },
      async rotate() {
        return {
          kind: "registered",
          credential: { ...credential, generation: 2 },
        };
      },
    },
    verifier: {
      verify() {
        return input.verifier === "valid"
          ? { kind: "valid", manifest }
          : { kind: "invalid", reason: "signature" };
      },
    },
  });
  return { controller, writes };
}

describe("installation policy runtime controller", () => {
  it("persists an operation before registration and exposes a verified policy", async () => {
    const { controller, writes } = createController({
      fetch: "received",
      identityRead: { kind: "empty" },
      verifier: "valid",
    });
    const settled = waitFor(
      controller,
      (model) => model.policy.phase === "valid",
    );

    controller.start();

    await expect(settled).resolves.toMatchObject({
      installation: {
        generation: 1,
        phase: "registered",
        reconciledAt: credential.reconciledAt,
      },
      policy: {
        effectiveSource: "fresh-verified",
        phase: "valid",
        sequence: 4,
      },
    });
    expect(writes[0]).toMatchObject({
      credential: null,
      pendingRegistrationId: "operation-95B4xv59NSmcKQz33cAj9g",
    });
    controller.dispose();
  });

  it("persists the secure identity before its Product-store marker and before Relay registration", async () => {
    const events: string[] = [];
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "absent" as const };
        },
        async writeInitialized() {
          events.push("marker");
        },
      },
      identityStore: {
        async read() {
          return { kind: "empty" as const };
        },
        async write() {
          events.push("secret");
        },
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          events.push("register");
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "registered",
    );
    controller.start();
    await settled;
    expect(events.slice(0, 3)).toEqual(["secret", "marker", "register"]);
    controller.dispose();
  });

  it("contains a missing secure identity when its Product marker exists", async () => {
    let registrations = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "initialized" as const };
        },
        async writeInitialized() {},
      },
      identityStore: {
        async read() {
          return { kind: "empty" as const };
        },
        async write() {
          throw new Error("must not replace a missing identity");
        },
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          registrations += 1;
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "terminal",
    );
    controller.start();
    await settled;
    expect(registrations).toBe(0);
    controller.dispose();
  });

  it("does not register when the marker save fails after a secure identity save", async () => {
    let registrations = 0;
    let secretWrites = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "absent" as const };
        },
        async writeInitialized() {
          throw new Error("Product store unavailable");
        },
      },
      identityStore: {
        async read() {
          return { kind: "empty" as const };
        },
        async write() {
          secretWrites += 1;
        },
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          registrations += 1;
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "retryable",
    );
    controller.start();
    await settled;
    expect(secretWrites).toBe(1);
    expect(registrations).toBe(0);
    controller.dispose();
  });

  it("does not create a marker or contact Relay when the first secure identity save fails", async () => {
    let markerWrites = 0;
    let registrations = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "absent" as const };
        },
        async writeInitialized() {
          markerWrites += 1;
        },
      },
      identityStore: {
        async read() {
          return { kind: "empty" as const };
        },
        async write() {
          throw new Error("SecureStore unavailable");
        },
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          registrations += 1;
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "retryable",
    );
    controller.start();
    await settled;
    expect(markerWrites).toBe(0);
    expect(registrations).toBe(0);
    controller.dispose();
  });

  it("backs a legacy ready identity with a marker without registering again", async () => {
    let markerWrites = 0;
    let registrations = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "absent" as const };
        },
        async writeInitialized() {
          markerWrites += 1;
        },
      },
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential,
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: null,
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          registrations += 1;
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "registered",
    );
    controller.start();
    await settled;
    expect(markerWrites).toBe(1);
    expect(registrations).toBe(0);
    controller.dispose();
  });

  it("repairs a corrupt marker for a ready identity but contains an empty identity", async () => {
    let repairs = 0;
    const ready = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "corrupt" as const };
        },
        async writeInitialized() {
          repairs += 1;
        },
      },
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential,
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: null,
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          throw new Error("ready identity must not register");
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const readySettled = waitFor(
      ready,
      (model) => model.installation.phase === "registered",
    );
    ready.start();
    await readySettled;
    expect(repairs).toBe(1);
    ready.dispose();

    let registrations = 0;
    const empty = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "corrupt" as const };
        },
        async writeInitialized() {
          throw new Error("must not repair empty identity");
        },
      },
      identityStore: {
        async read() {
          return { kind: "empty" as const };
        },
        async write() {
          throw new Error("must not create identity");
        },
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          registrations += 1;
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const emptySettled = waitFor(
      empty,
      (model) => model.installation.phase === "terminal",
    );
    empty.start();
    await emptySettled;
    expect(registrations).toBe(0);
    empty.dispose();
  });

  it("keeps an unexpired verified cache effective after an invalid candidate", async () => {
    const { controller } = createController({
      fetch: "received",
      identityRead: {
        kind: "ready",
        state: {
          credential,
          installationId: credential.installationId,
          pendingRegistrationId: null,
          pendingRotationId: null,
        },
      },
      storedSnapshot: {
        manifest,
        verifiedAtEpochMs: Date.parse("2026-09-06T00:00:00.000Z"),
      },
      verifier: "invalid",
    });
    const settled = waitFor(controller, (model) =>
      model.detail.includes("rejected"),
    );

    controller.start();

    await expect(settled).resolves.toMatchObject({
      policy: {
        effectiveSource: "verified-cache",
        phase: "cached",
        reason: "invalid",
        sequence: 4,
      },
    });
    controller.dispose();
  });

  it("shows a restored verified cache while the cold-start Relay request is checking", async () => {
    let resolveManifest:
      | ((result: {
          readonly kind: "failure";
          readonly failure: { readonly kind: "offline" };
        }) => void)
      | null = null;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "initialized" as const };
        },
        async writeInitialized() {},
      },
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential,
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: null,
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return {
            manifest,
            verifiedAtEpochMs: Date.parse("2026-09-06T00:00:00.000Z"),
          };
        },
        async write() {
          return true;
        },
      },
      transport: {
        readManifest: () =>
          new Promise((resolve) => {
            resolveManifest = resolve;
          }),
        async register() {
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const checking = waitFor(
      controller,
      (model) =>
        model.policy.phase === "checking" &&
        model.policy.effectiveSource === "verified-cache",
    );
    controller.start();
    await expect(checking).resolves.toMatchObject({
      policy: {
        reason: null,
        sequence: 4,
        verifiedAt: "2026-09-06T00:00:00.000Z",
      },
    });
    resolveManifest?.({ kind: "failure", failure: { kind: "offline" } });
    controller.dispose();
  });

  it("retains typed policy failure reasons when no cache is available", async () => {
    for (const [failure, reason] of [
      ["offline", "offline"],
      ["unavailable", "relay-unavailable"],
      ["rate-limited", "relay-unavailable"],
    ] as const) {
      const controller = createInstallationPolicyRuntimeController({
        environment: "development",
        identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
        identityPresenceStore: createIdentityPresenceStore(),
        identityStore: {
          async read() {
            return {
              kind: "ready" as const,
              state: {
                credential,
                installationId: credential.installationId,
                pendingRegistrationId: null,
                pendingRotationId: null,
              },
            };
          },
          async write() {},
        },
        nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
        policyStore: {
          async read() {
            return null;
          },
          async write() {
            return true;
          },
        },
        transport: {
          async readManifest() {
            return {
              kind: "failure" as const,
              failure:
                failure === "rate-limited"
                  ? { kind: failure, retryAfterSeconds: 1 }
                  : { kind: failure },
            };
          },
          async register() {
            return { kind: "registered" as const, credential };
          },
          async rotate() {
            return { kind: "registered" as const, credential };
          },
        },
        verifier: {
          verify() {
            return { kind: "invalid" as const, reason: "schema" as const };
          },
        },
      });
      const settled = waitFor(
        controller,
        (model) => model.policy.reason === reason,
      );
      controller.start();
      await settled;
      expect(controller.snapshot().policy.effectiveSource).toBe(
        "baked-safe-fallback",
      );
      controller.dispose();
    }
  });

  it("reports cache-write when a verified candidate cannot be persisted without prior cache", async () => {
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: {
        async read() {
          return { kind: "initialized" as const };
        },
        async writeInitialized() {},
      },
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential,
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: null,
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return false;
        },
      },
      transport: {
        async readManifest() {
          return { kind: "received" as const, payload: {} };
        },
        async register() {
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "valid" as const, manifest };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.policy.reason === "cache-write",
    );
    controller.start();
    await expect(settled).resolves.toMatchObject({
      policy: {
        effectiveSource: "baked-safe-fallback",
        phase: "safe-fallback",
      },
    });
    controller.dispose();
  });

  it("does not contradict a retained verified cache when registration fails", async () => {
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: createIdentityPresenceStore(),
      identityStore: {
        async read() {
          return { kind: "empty" as const };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return {
            manifest,
            verifiedAtEpochMs: Date.parse("2026-09-06T00:00:00.000Z"),
          };
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          return {
            kind: "failure" as const,
            failure: { kind: "unavailable" as const },
          };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "retryable",
    );
    controller.start();
    await expect(settled).resolves.toMatchObject({
      policy: { effectiveSource: "verified-cache" },
    });
    expect(controller.snapshot().installation.detail).not.toContain(
      "safe fallback",
    );
    controller.dispose();
  });

  it("contains corrupt credentials as terminal safe fallback without replacing them", async () => {
    const { controller, writes } = createController({
      fetch: "received",
      identityRead: { kind: "corrupt" },
      verifier: "valid",
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "terminal",
    );

    controller.start();

    await expect(settled).resolves.toMatchObject({
      policy: { phase: "safe-fallback" },
      retryInstallationRegistrationEnabled: false,
    });
    expect(writes).toEqual([]);
    controller.dispose();
  });

  it("replays a pending rotation before attempting expired-credential reconciliation", async () => {
    let rotations = 0;
    let registrations = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: createIdentityPresenceStore(),
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential: {
                ...credential,
                credentialExpiresAt: "2026-09-06T00:00:00.000Z",
              },
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: "rotate-95B4xv59NSmcKQz33cAj9g",
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "unavailable" as const },
          };
        },
        async register() {
          registrations += 1;
          return {
            kind: "failure" as const,
            failure: { kind: "unavailable" as const },
          };
        },
        async rotate() {
          rotations += 1;
          return {
            kind: "registered" as const,
            credential: { ...credential, generation: 2 },
          };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.generation === 2,
    );

    controller.start();

    await settled;
    expect(rotations).toBe(1);
    expect(registrations).toBe(0);
    controller.dispose();
  });

  it("does not write or call Relay after disposal during an awaited identity read", async () => {
    let resolveRead: ((result: InstallationIdentityReadResult) => void) | null =
      null;
    let enteredRead: (() => void) | null = null;
    const readStarted = new Promise<void>((resolve) => {
      enteredRead = resolve;
    });
    let calls = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: createIdentityPresenceStore(),
      identityStore: {
        read: () =>
          new Promise((resolve) => {
            resolveRead = resolve;
            enteredRead?.();
          }),
        async write() {
          calls += 1;
        },
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          calls += 1;
          return {
            kind: "failure" as const,
            failure: { kind: "unavailable" as const },
          };
        },
        async register() {
          calls += 1;
          return {
            kind: "failure" as const,
            failure: { kind: "unavailable" as const },
          };
        },
        async rotate() {
          calls += 1;
          return {
            kind: "failure" as const,
            failure: { kind: "unavailable" as const },
          };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });

    controller.start();
    await readStarted;
    controller.dispose();
    if (resolveRead !== null) resolveRead({ kind: "empty" });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(0);
  });

  it("does not schedule an expired cache or repeatedly retry it while offline", async () => {
    let manifestReads = 0;
    let resolveSecondRead: (() => void) | null = null;
    const secondRead = new Promise<void>((resolve) => {
      resolveSecondRead = resolve;
    });
    const scheduled: (() => void)[] = [];
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: createIdentityPresenceStore(),
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential,
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: null,
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return {
            manifest: { ...manifest, expiresAt: "2026-09-06T00:00:00.000Z" },
            verifiedAtEpochMs: 1,
          };
        },
        async write() {
          return true;
        },
      },
      schedule(callback) {
        scheduled.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      transport: {
        async readManifest() {
          manifestReads += 1;
          if (manifestReads === 2) resolveSecondRead?.();
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(controller, (model) =>
      model.detail.includes("could not refresh"),
    );
    controller.start();
    await settled;

    expect(scheduled).toEqual([]);
    expect(manifestReads).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.onForeground();
    await secondRead;
    expect(manifestReads).toBe(2);
    controller.onForeground();
    await Promise.resolve();
    expect(manifestReads).toBe(2);
    controller.dispose();
  });

  it("treats an exhausted pending rotation replay as terminal without reconciliation", async () => {
    let registrations = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: createIdentityPresenceStore(),
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential: {
                ...credential,
                credentialExpiresAt: "2026-09-06T00:00:00.000Z",
              },
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: "rotate-95B4xv59NSmcKQz33cAj9g",
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          registrations += 1;
          return {
            kind: "failure" as const,
            failure: { kind: "unauthorized" as const },
          };
        },
        async rotate() {
          return {
            kind: "failure" as const,
            failure: { kind: "unauthorized" as const },
          };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const settled = waitFor(
      controller,
      (model) => model.installation.phase === "terminal",
    );
    controller.start();
    await expect(settled).resolves.toMatchObject({
      retryInstallationRegistrationEnabled: false,
    });
    expect(registrations).toBe(0);
    controller.dispose();
  });

  it("retains a higher observed monotonic floor after its save fails and disk reloads an older policy", async () => {
    const previousSequences: (number | null)[] = [];
    let fetches = 0;
    let resolveSecondFetch: (() => void) | null = null;
    const secondFetch = new Promise<void>((resolve) => {
      resolveSecondFetch = resolve;
    });
    let resolveSecondVerification: (() => void) | null = null;
    const secondVerification = new Promise<void>((resolve) => {
      resolveSecondVerification = resolve;
    });
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => "operation-95B4xv59NSmcKQz33cAj9g" },
      identityPresenceStore: createIdentityPresenceStore(),
      identityStore: {
        async read() {
          return {
            kind: "ready" as const,
            state: {
              credential,
              installationId: credential.installationId,
              pendingRegistrationId: null,
              pendingRotationId: null,
            },
          };
        },
        async write() {},
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return { manifest, verifiedAtEpochMs: 1 };
        },
        async write() {
          return false;
        },
      },
      transport: {
        async readManifest() {
          fetches += 1;
          if (fetches === 2) resolveSecondFetch?.();
          return { kind: "received" as const, payload: { fetches } };
        },
        async register() {
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify(input) {
          previousSequences.push(input.previousManifest?.sequence ?? null);
          if (previousSequences.length === 2) resolveSecondVerification?.();
          return {
            kind: "valid" as const,
            manifest: { ...manifest, sequence: 5 },
          };
        },
      },
    });
    const first = waitFor(controller, (model) =>
      model.detail.includes("could not be saved"),
    );
    controller.start();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.refreshCapabilityPolicy();
    await secondFetch;
    await secondVerification;

    expect(previousSequences).toEqual([4, 5]);
    controller.dispose();
  });

  it("hands a pending real SecureStore write from a disposed controller to a new controller without a stale Relay call", async () => {
    const values = new Map<string, string>();
    let releaseWrite: (() => void) | null = null;
    let startedWrite: (() => void) | null = null;
    const writeStarted = new Promise<void>((resolve) => {
      startedWrite = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const identityStore = createSecureInstallationIdentityStore({
      async delete() {},
      async get(key) {
        return values.get(key) ?? null;
      },
      async isAvailable() {
        return true;
      },
      async set(key, value) {
        startedWrite?.();
        await writeGate;
        values.set(key, value);
      },
    });
    let marker = false;
    let staleRegistrations = 0;
    let resumedRegistration: {
      readonly installationId: string;
      readonly registrationId: string;
    } | null = null;
    const common = {
      environment: "development" as const,
      identityPresenceStore: {
        async read() {
          return marker
            ? { kind: "initialized" as const }
            : { kind: "absent" as const };
        },
        async writeInitialized() {
          marker = true;
        },
      },
      identityStore,
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    };
    const first = createInstallationPolicyRuntimeController({
      ...common,
      identitySource: {
        create: () => "first-operation-95B4xv59NSmcKQz33cAj9g",
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register() {
          staleRegistrations += 1;
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
    });
    first.start();
    await writeStarted;
    first.dispose();

    const second = createInstallationPolicyRuntimeController({
      ...common,
      identitySource: {
        create: () => "second-operation-95B4xv59NSmcKQz33cAj9g",
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register(input) {
          resumedRegistration = {
            installationId: input.installationId,
            registrationId: input.registrationId,
          };
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
    });
    const settled = waitFor(
      second,
      (model) => model.installation.phase === "registered",
    );
    second.start();
    releaseWrite?.();
    await settled;
    expect(staleRegistrations).toBe(0);
    expect(resumedRegistration).toEqual({
      installationId: "first-operation-95B4xv59NSmcKQz33cAj9g",
      registrationId: "first-operation-95B4xv59NSmcKQz33cAj9g",
    });
    second.dispose();
  });

  it("reuses the saved identity and registration operation after a marker retry", async () => {
    let identity: InstallationIdentityReadResult = { kind: "empty" };
    let markerFails = true;
    const attempts: {
      readonly installationId: string;
      readonly registrationId: string;
    }[] = [];
    const generated = [
      "installation-95B4xv59NSmcKQz33cAj9g",
      "registration-95B4xv59NSmcKQz33cAj9g",
      "unexpected-95B4xv59NSmcKQz33cAj9g",
    ];
    let createCalls = 0;
    const controller = createInstallationPolicyRuntimeController({
      environment: "development",
      identitySource: { create: () => generated[createCalls++] },
      identityPresenceStore: {
        async read() {
          return { kind: "absent" as const };
        },
        async writeInitialized() {
          if (markerFails) throw new Error("marker unavailable");
        },
      },
      identityStore: {
        async read() {
          return identity;
        },
        async write(state) {
          identity = { kind: "ready", state };
        },
      },
      nowEpochMs: () => Date.parse("2026-09-07T00:00:00.000Z"),
      policyStore: {
        async read() {
          return null;
        },
        async write() {
          return true;
        },
      },
      transport: {
        async readManifest() {
          return {
            kind: "failure" as const,
            failure: { kind: "offline" as const },
          };
        },
        async register(input) {
          attempts.push({
            installationId: input.installationId,
            registrationId: input.registrationId,
          });
          return { kind: "registered" as const, credential };
        },
        async rotate() {
          return { kind: "registered" as const, credential };
        },
      },
      verifier: {
        verify() {
          return { kind: "invalid" as const, reason: "schema" as const };
        },
      },
    });
    const failed = waitFor(
      controller,
      (model) => model.installation.phase === "retryable",
    );
    controller.start();
    await failed;
    markerFails = false;
    await Promise.resolve();
    const recovered = waitFor(
      controller,
      (model) => model.installation.phase === "registered",
    );
    controller.retryInstallationRegistration();
    await recovered;
    expect(attempts).toEqual([
      { installationId: generated[0], registrationId: generated[1] },
    ]);
    expect(createCalls).toBe(2);
    controller.dispose();
  });
});
