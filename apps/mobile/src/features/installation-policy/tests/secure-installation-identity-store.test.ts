import { describe, expect, it } from "vitest";

import { createSecureInstallationIdentityStore } from "../data/secure-installation-identity-store";

describe("secure installation identity storage", () => {
  it("round trips a grant without serializing its in-memory installation extension", async () => {
    const values = new Map<string, string>();
    const store = createSecureInstallationIdentityStore({
      async delete(key) {
        values.delete(key);
      },
      async get(key) {
        return values.get(key) ?? null;
      },
      async isAvailable() {
        return true;
      },
      async set(key, value) {
        values.set(key, value);
      },
    });
    const state = {
      credential: {
        credential: `v1.${"A".repeat(43)}.${"B".repeat(43)}`,
        credentialExpiresAt: "2026-09-08T01:00:00.000Z",
        generation: 2,
        installationId: "de3c0860-7340-4f2d-b7bb-bc091f9150b0",
        reconciledAt: "2026-09-08T00:00:00.000Z",
      },
      installationId: "de3c0860-7340-4f2d-b7bb-bc091f9150b0",
      pendingRegistrationId: null,
      pendingRotationId: "rotate-95B4xv59NSmcKQz33cAj9g",
    };

    await store.write(state);

    await expect(store.read()).resolves.toEqual({ kind: "ready", state });
  });

  it("distinguishes a corrupt stored record from a first installation", async () => {
    const store = createSecureInstallationIdentityStore({
      async delete() {},
      async get() {
        return "not-json";
      },
      async isAvailable() {
        return true;
      },
      async set() {},
    });

    await expect(store.read()).resolves.toEqual({ kind: "corrupt" });
  });

  it("serializes a new controller read behind an in-flight secure write", async () => {
    let stored: string | null = null;
    let releaseWrite: (() => void) | null = null;
    let reads = 0;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const store = createSecureInstallationIdentityStore({
      async delete() {},
      async get() {
        reads += 1;
        return stored;
      },
      async isAvailable() {
        return true;
      },
      async set(_key, value) {
        await writeGate;
        stored = value;
      },
    });
    const state = {
      credential: null,
      installationId: "de3c0860-7340-4f2d-b7bb-bc091f9150b0",
      pendingRegistrationId: "register-95B4xv59NSmcKQz33cAj9g",
      pendingRotationId: null,
    };

    const write = store.write(state);
    const read = store.read();
    await Promise.resolve();
    expect(reads).toBe(0);
    releaseWrite?.();

    await write;
    await expect(read).resolves.toEqual({ kind: "ready", state });
  });
});
