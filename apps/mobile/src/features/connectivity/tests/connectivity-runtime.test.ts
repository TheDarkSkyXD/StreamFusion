import { describe, expect, it, vi } from "vitest";

import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import { createConnectivityRuntime } from "../composition/connectivity-runtime";

vi.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({
    isConnected: true,
    isInternetReachable: true,
  }),
}));

vi.mock("../../../../modules/streamfusion-native-contracts/src/contracts", () => ({
  getConnectivityModule() {
    throw new Error("native unavailable");
  },
}));

function memorySettings(initial: Record<string, string> = {}): ProductSettingsStore {
  const rows = { ...initial };
  return {
    async read(key: string) {
      return rows[key] ?? null;
    },
    async write(key: string, value: string, _updatedAt: number) {
      rows[key] = value;
    },
  };
}

function memorySecrets() {
  const rows = new Map<string, string>();
  return {
    async delete(key: string) {
      rows.delete(key);
    },
    async get(key: string) {
      return rows.get(key) ?? null;
    },
    async isAvailable() {
      return true;
    },
    async set(key: string, value: string) {
      rows.set(key, value);
    },
  };
}

describe("connectivity runtime", () => {
  it("persists a valid proxy and keeps credentials off the settings row", async () => {
    const settings = memorySettings();
    const secrets = memorySecrets();
    const session = createConnectivityRuntime({
      readNetwork: async () => "online",
      secrets,
      settings,
    });
    const saved = await session.saveDraft({
      enabled: true,
      host: "127.0.0.1",
      password: "secret",
      portText: "8080",
      username: "alice",
    });
    expect(saved.parse.kind).toBe("ready");
    expect(saved.saveDetail).toBe("Proxy settings saved.");
    expect(await settings.read("proxy.v1")).not.toContain("secret");
    expect(await secrets.get("proxy.credentials.v1")).toContain("alice");
    const loaded = await session.load();
    expect(loaded.draft).toEqual({
      enabled: true,
      host: "127.0.0.1",
      password: "secret",
      portText: "8080",
      username: "alice",
    });
  });

  it("keeps an invalid draft visible without writing", async () => {
    const settings = memorySettings();
    const session = createConnectivityRuntime({
      readNetwork: async () => "offline",
      secrets: memorySecrets(),
      settings,
    });
    const next = await session.saveDraft({
      enabled: true,
      host: "",
      password: "",
      portText: "",
      username: "",
    });
    expect(next.parse.kind).toBe("invalid");
    expect(await settings.read("proxy.v1")).toBeNull();
    expect(next.network).toBe("offline");
  });

  it("fails closed when a proxy is on without the native module", async () => {
    const session = createConnectivityRuntime({
      readNetwork: async () => "online",
      secrets: memorySecrets(),
      settings: memorySettings(),
    });
    await session.saveDraft({
      enabled: true,
      host: "127.0.0.1",
      password: "",
      portText: "8080",
      username: "",
    });
    await expect(session.fetch("https://example.com/")).rejects.toThrow(
      /StreamFusion Development/,
    );
  });

  it("uses ordinary fetch when the proxy is off", async () => {
    const session = createConnectivityRuntime({
      readNetwork: async () => "online",
      secrets: memorySecrets(),
      settings: memorySettings(),
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("ok", { status: 200 })) as typeof fetch;
    try {
      const response = await session.fetch("https://example.com/");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    } finally {
      globalThis.fetch = original;
    }
  });
});
