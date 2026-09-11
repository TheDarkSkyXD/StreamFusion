import { afterEach, describe, expect, it, vi } from "vitest";

import { KICK_ANDROID_REDIRECT_URI } from "@streamfusion/core/auth";

import { createDevelopmentKickAuthFixture } from "../adapters/kick/development-kick-auth-fixture";
import { createSecureKickCredentialRepository } from "../data/secure-kick-credential-repository";
import { createKickAccountSessionController } from "../domain/kick-account-session-controller";
import type { SecureSecretStore } from "../../storage/capabilities/persistence";

function secrets(): SecureSecretStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    delete: async (key) => void values.delete(key),
    get: async (key) => values.get(key) ?? null,
    isAvailable: async () => true,
    set: async (key, value) => void values.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Kick account session controller", () => {
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
      clientId: "streamfusion-development-kick-fixture",
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
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("disconnected"));
    await controller.connect();
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
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("disconnected"));
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
      clientId: "fixture",
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
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("disconnected"));
    await controller.connect();
    await controller.cancel();
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("disconnected"));
    await controller.connect();
    await controller.injectFixture?.("denied");
    const failed = controller.getSnapshot();
    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") throw new Error("expected failed");
    expect(failed.message).toBe("Kick denied this connection.");
  });

  it("stays unavailable without a gateway", async () => {
    const controller = createKickAccountSessionController({
      authorize: async () => {
        throw new Error("unused");
      },
      callbacks: { subscribe: () => () => undefined },
      clientId: null,
      gateway: null,
      open: async () => undefined,
      repository: createSecureKickCredentialRepository({
        secrets: secrets(),
        key: `kick-unavail-${Math.random()}`,
      }),
    });
    controller.setForeground(true);
    await vi.waitFor(() => expect(controller.getSnapshot().kind).toBe("unavailable"));
  });
});
