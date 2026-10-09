import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KICK_ANDROID_REDIRECT_URI,
  kickAttemptId,
  kickCredentialGeneration,
} from "@streamfusion/core/auth";

import { createDevelopmentKickAuthFixture } from "../adapters/kick/development-kick-auth-fixture";
import { createSecureKickCredentialRepository } from "../data/secure-kick-credential-repository";
import { createKickAccountSessionController } from "../domain/kick-account-session-controller";
import type { SecureSecretStore } from "../../storage/capabilities/persistence";

function secrets(): SecureSecretStore & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    delete: async (key) => void values.delete(key),
    get: async (key) => values.get(key) ?? null,
    isAvailable: async () => true,
    set: async (key, value) => void values.set(key, value),
  };
}

function authorization(state: string) {
  return {
    authorizeUrl: `https://id.kick.com/oauth/authorize?state=${state}`,
    codeVerifier: "a".repeat(43),
    expiresAtEpochMs: 605_000,
    redirectUri: KICK_ANDROID_REDIRECT_URI,
    state,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Kick account session controller", () => {
  it("does not persist authorization that resolves after backgrounding", async () => {
    vi.stubGlobal("__DEV__", true);
    const deferred = Promise.withResolvers<ReturnType<typeof authorization>>();
    const repository = createSecureKickCredentialRepository({
      secrets: secrets(),
      key: `kick-late-background-${Math.random()}`,
    });
    const open = vi.fn(async (_url: string, _signal: { readonly aborted: boolean }) => undefined);
    const controller = createKickAccountSessionController({
      authorize: () => deferred.promise,
      callbacks: { subscribe: () => () => undefined },
      gateway: createDevelopmentKickAuthFixture({ now: () => 5_000 }),
      now: () => 5_000,
      open,
      repository,
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    const connecting = controller.connect();
    expect(controller.getSnapshot().kind).toBe("launching");
    controller.setForeground(false);
    deferred.resolve(authorization("late-background"));
    await connecting;
    expect(await repository.read()).toEqual({
      kind: "disconnected",
      generation: kickCredentialGeneration(0),
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("clears an attempt persisted after backgrounding during launch", async () => {
    vi.stubGlobal("__DEV__", true);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const repository = createSecureKickCredentialRepository({
      secrets: secrets(),
      key: `kick-background-launch-${Math.random()}`,
    });
    const delayedRepository = {
      ...repository,
      beginLaunch: async (input: Parameters<typeof repository.beginLaunch>[0]) => {
        entered.resolve();
        await release.promise;
        return repository.beginLaunch(input);
      },
    };
    const open = vi.fn(async (_url: string) => undefined);
    const controller = createKickAccountSessionController({
      authorize: async () => authorization("background-launch"),
      callbacks: { subscribe: () => () => undefined },
      gateway: createDevelopmentKickAuthFixture({ now: () => 5_000 }),
      now: () => 5_000,
      open,
      repository: delayedRepository,
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    const connecting = controller.connect();
    await entered.promise;
    controller.setForeground(false);
    release.resolve();
    await connecting;
    expect(await repository.read()).toEqual({
      kind: "disconnected",
      generation: kickCredentialGeneration(0),
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not persist authorization that resolves after cancellation", async () => {
    vi.stubGlobal("__DEV__", true);
    const deferred = Promise.withResolvers<ReturnType<typeof authorization>>();
    const repository = createSecureKickCredentialRepository({
      secrets: secrets(),
      key: `kick-late-cancel-${Math.random()}`,
    });
    const open = vi.fn(async (_url: string) => undefined);
    const controller = createKickAccountSessionController({
      authorize: () => deferred.promise,
      callbacks: { subscribe: () => () => undefined },
      gateway: createDevelopmentKickAuthFixture({ now: () => 5_000 }),
      now: () => 5_000,
      open,
      repository,
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    const connecting = controller.connect();
    await controller.cancel();
    deferred.resolve(authorization("late-cancel"));
    await connecting;
    expect(await repository.read()).toEqual({
      kind: "disconnected",
      generation: kickCredentialGeneration(0),
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer attempt when older authorization resolves", async () => {
    vi.stubGlobal("__DEV__", true);
    const deferred = Promise.withResolvers<ReturnType<typeof authorization>>();
    const repository = createSecureKickCredentialRepository({
      secrets: secrets(),
      key: `kick-late-replacement-${Math.random()}`,
    });
    const open = vi.fn(async (_url: string, _signal: { readonly aborted: boolean }) => undefined);
    let authorizationCount = 0;
    const controller = createKickAccountSessionController({
      authorize: () =>
        ++authorizationCount === 1
          ? deferred.promise
          : Promise.resolve(authorization("newer")),
      callbacks: { subscribe: () => () => undefined },
      gateway: createDevelopmentKickAuthFixture({ now: () => 5_000 }),
      now: () => 5_000,
      open,
      repository,
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    const older = controller.connect();
    await controller.connect();
    deferred.resolve(authorization("older"));
    await older;
    expect(await repository.read()).toMatchObject({
      kind: "pending",
      attempt: { state: "newer" },
    });
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://id.kick.com/oauth/authorize?state=newer",
      expect.objectContaining({ aborted: false }),
    );
    const launchSignal = open.mock.calls[0]?.[1];
    await controller.cancel();
    expect(launchSignal?.aborted).toBe(true);
  });

  it("accepts a cold-start callback after restoring the encrypted attempt", async () => {
    vi.stubGlobal("__DEV__", true);
    const fixture = createDevelopmentKickAuthFixture({ now: () => 5_000 });
    const repository = createSecureKickCredentialRepository({
      secrets: secrets(),
      key: `kick-cold-${Math.random()}`,
    });
    const state = `sf1.d.${"A".repeat(43)}`;
    const attemptId = kickAttemptId("cold-attempt");
    await repository.beginLaunch({
      attempt: {
        attemptId,
        codeVerifier: "a".repeat(43),
        expiresAtEpochMs: 600_000,
        generation: kickCredentialGeneration(0),
        redirectUri: KICK_ANDROID_REDIRECT_URI,
        state,
      },
      expectedGeneration: kickCredentialGeneration(0),
    });
    await repository.markPending(attemptId);
    const controller = createKickAccountSessionController({
      authorize: async () => {
        throw new Error("not expected");
      },
      callbacks: {
        subscribe(listener) {
          listener(fixture.inject("accepted", { state }));
          return () => undefined;
        },
      },
      gateway: fixture,
      now: () => 5_000,
      open: async () => undefined,
      repository,
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("connected"),
    );
    expect((await repository.read()).kind).toBe("ready");
    controller.setForeground(false);
  });

  it("serializes duplicate callbacks and retries an offline exchange", async () => {
    vi.stubGlobal("__DEV__", true);
    const fixture = createDevelopmentKickAuthFixture({ now: () => 5_000 });
    const originalExchange = fixture.exchange;
    const exchange = vi
      .fn<typeof fixture.exchange>()
      .mockResolvedValueOnce({ kind: "transient-failure", cause: "offline" })
      .mockImplementation(originalExchange);
    fixture.exchange = exchange;
    let deliver:
      ((input: ReturnType<typeof fixture.inject>) => void) | undefined;
    const state = `sf1.d.${"B".repeat(43)}`;
    const controller = createKickAccountSessionController({
      authorize: async ({ nowEpochMs }) => ({
        authorizeUrl: "https://id.kick.com/oauth/authorize",
        codeVerifier: "a".repeat(43),
        expiresAtEpochMs: nowEpochMs + 600_000,
        redirectUri: KICK_ANDROID_REDIRECT_URI,
        state,
      }),
      callbacks: {
        subscribe(listener) {
          deliver = listener;
          return () => undefined;
        },
      },
      gateway: fixture,
      now: () => 5_000,
      open: async () => undefined,
      repository: createSecureKickCredentialRepository({
        secrets: secrets(),
        key: `kick-retry-${Math.random()}`,
      }),
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    await controller.connect();
    const callback = fixture.inject("accepted", { state });
    deliver?.(callback);
    deliver?.(callback);
    await vi.waitFor(() =>
      expect(controller.getSnapshot()).toMatchObject({
        kind: "failed",
        message: "Kick is unavailable. Check your connection and retry.",
      }),
    );
    expect(exchange).toHaveBeenCalledOnce();
    await controller.retry();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("connected"),
    );
    expect(exchange).toHaveBeenCalledTimes(2);
    controller.setForeground(false);
  });

  it("commits a one-use code once when backgrounded during exchange", async () => {
    vi.stubGlobal("__DEV__", true);
    const fixture = createDevelopmentKickAuthFixture({ now: () => 5_000 });
    const redeemed =
      Promise.withResolvers<Awaited<ReturnType<typeof fixture.exchange>>>();
    const exchange = vi
      .fn<typeof fixture.exchange>()
      .mockImplementationOnce(async ({ signal }) => {
        signal.onCancel(() =>
          redeemed.resolve({ kind: "transient-failure", cause: "cancelled" }),
        );
        return redeemed.promise;
      })
      .mockResolvedValue({ kind: "rejected" });
    fixture.exchange = exchange;
    const state = `sf1.d.${"C".repeat(43)}`;
    let deliver:
      ((input: ReturnType<typeof fixture.inject>) => void) | undefined;
    const repository = createSecureKickCredentialRepository({
      secrets: secrets(),
      key: `kick-background-${Math.random()}`,
    });
    const controller = createKickAccountSessionController({
      authorize: async ({ nowEpochMs }) => ({
        authorizeUrl: "https://id.kick.com/oauth/authorize",
        codeVerifier: "a".repeat(43),
        expiresAtEpochMs: nowEpochMs + 600_000,
        redirectUri: KICK_ANDROID_REDIRECT_URI,
        state,
      }),
      callbacks: {
        subscribe(listener) {
          deliver = listener;
          return () => undefined;
        },
      },
      gateway: fixture,
      now: () => 5_000,
      open: async () => undefined,
      repository,
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    await controller.connect();
    deliver?.(fixture.inject("accepted", { state }));
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledOnce());
    controller.setForeground(false);
    redeemed.resolve({
      kind: "exchanged",
      accessToken: "one-use-access-token",
      refreshToken: "one-use-refresh-token",
      expiresInSeconds: 3_600,
      scopes: ["user:read"],
    });
    await vi.waitFor(async () =>
      expect(await repository.read()).toMatchObject({
        kind: "ready",
        credential: { accessToken: "one-use-access-token" },
      }),
    );
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("connected"),
    );
    expect(exchange).toHaveBeenCalledOnce();
    controller.setForeground(false);
  });

  it("shows a retryable failure when the Kick browser cannot open", async () => {
    vi.stubGlobal("__DEV__", true);
    const fixture = createDevelopmentKickAuthFixture({ now: () => 5_000 });
    const controller = createKickAccountSessionController({
      authorize: async ({ nowEpochMs }) => ({
        authorizeUrl: "https://id.kick.com/oauth/authorize",
        codeVerifier: "a".repeat(43),
        expiresAtEpochMs: nowEpochMs + 600_000,
        redirectUri: KICK_ANDROID_REDIRECT_URI,
        state: `sf1.d.${"D".repeat(43)}`,
      }),
      callbacks: { subscribe: () => () => undefined },
      gateway: fixture,
      now: () => 5_000,
      open: async () => {
        throw new Error("browser unavailable");
      },
      repository: createSecureKickCredentialRepository({
        secrets: secrets(),
        key: `kick-browser-${Math.random()}`,
      }),
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    await controller.connect();
    expect(controller.getSnapshot()).toMatchObject({
      kind: "failed",
      failure: "connection",
      message: "In-app Kick sign-in could not open. Enable or update a compatible browser, then retry.",
    });
    controller.setForeground(false);
  });

  it("connects through the development fixture and disconnects only Kick state", async () => {
    vi.stubGlobal("__DEV__", true);
    const fixture = createDevelopmentKickAuthFixture({ now: () => 5_000 });
    const controller = createKickAccountSessionController({
      authorize: async ({ nowEpochMs }) => ({
        authorizeUrl: "https://id.kick.com/oauth/authorize?fixture=1",
        codeVerifier: "a".repeat(43),
        expiresAtEpochMs: nowEpochMs + 600_000,
        redirectUri: KICK_ANDROID_REDIRECT_URI,
        state: "development-kick-state",
      }),
      callbacks: { subscribe: () => () => undefined },
      fixture,
      gateway: fixture,
      now: () => 5_000,
      open: async () => undefined,
      repository: createSecureKickCredentialRepository({
        secrets: secrets(),
        key: `kick-session-${Math.random()}`,
      }),
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    await controller.connect();
    expect(controller.getSnapshot().kind).toBe("pending");
    await controller.injectFixture?.("state-mismatch");
    expect(controller.getSnapshot().kind).toBe("pending");
    await controller.injectFixture?.("accepted");
    const connected = controller.getSnapshot();
    expect(connected.kind).toBe("connected");
    if (connected.kind !== "connected") throw new Error("expected connected");
    expect(connected.displayName).toBe("Kick development fixture");
    expect(connected.missingScopes).toEqual([]);
    controller.manage();
    await controller.disconnect();
    expect(controller.getSnapshot().kind).toBe("connected");
    await controller.disconnect();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
  });

  it("cancels a pending attempt and reports fixture denial", async () => {
    vi.stubGlobal("__DEV__", true);
    const fixture = createDevelopmentKickAuthFixture({ now: () => 5_000 });
    const controller = createKickAccountSessionController({
      authorize: async ({ nowEpochMs }) => ({
        authorizeUrl: "https://id.kick.com/oauth/authorize?fixture=1",
        codeVerifier: "a".repeat(43),
        expiresAtEpochMs: nowEpochMs + 600_000,
        redirectUri: KICK_ANDROID_REDIRECT_URI,
        state: "development-kick-state",
      }),
      callbacks: { subscribe: () => () => undefined },
      fixture,
      gateway: fixture,
      now: () => 5_000,
      open: async () => undefined,
      repository: createSecureKickCredentialRepository({
        secrets: secrets(),
        key: `kick-cancel-${Math.random()}`,
      }),
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    await controller.connect();
    await controller.cancel();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("disconnected"),
    );
    await controller.connect();
    await controller.injectFixture?.("denied");
    const failed = controller.getSnapshot();
    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") throw new Error("expected failed");
    expect(failed.message).toBe("Kick denied this connection.");
    await controller.retry();
    expect(controller.getSnapshot().kind).toBe("pending");
    await controller.injectFixture?.("accepted");
    expect(controller.getSnapshot().kind).toBe("connected");
  });

  it("stays unavailable without a gateway", async () => {
    const controller = createKickAccountSessionController({
      authorize: async () => {
        throw new Error("unused");
      },
      callbacks: { subscribe: () => () => undefined },
      gateway: null,
      open: async () => undefined,
      repository: createSecureKickCredentialRepository({
        secrets: secrets(),
        key: `kick-unavail-${Math.random()}`,
      }),
    });
    controller.setForeground(true);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().kind).toBe("unavailable"),
    );
  });
});
