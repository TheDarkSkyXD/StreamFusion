import { describe, expect, it } from "vitest";

import { createProductInstallationIdentityPresenceStore } from "../data/product-installation-identity-presence-store";

describe("Product installation identity presence store", () => {
  it("writes and reads only the initialized marker", async () => {
    let value: string | null = null;
    const store = createProductInstallationIdentityPresenceStore(
      {
        async read() {
          return value;
        },
        async write(next) {
          value = next;
        },
      },
      () => 10,
    );

    await expect(store.read()).resolves.toEqual({ kind: "absent" });
    await store.writeInitialized();
    await expect(store.read()).resolves.toEqual({ kind: "initialized" });
    expect(value).toBe('{"state":"initialized","version":1}');
  });

  it("contains malformed marker data", async () => {
    const store = createProductInstallationIdentityPresenceStore(
      {
        async read() {
          return "unexpected";
        },
        async write() {},
      },
      () => 10,
    );

    await expect(store.read()).resolves.toEqual({ kind: "corrupt" });
  });

  it("rejects a write that cannot be read back", async () => {
    const store = createProductInstallationIdentityPresenceStore(
      {
        async read() {
          return null;
        },
        async write() {},
      },
      () => 10,
    );

    await expect(store.writeInitialized()).rejects.toThrow(
      "presence marker did not persist",
    );
  });
});
