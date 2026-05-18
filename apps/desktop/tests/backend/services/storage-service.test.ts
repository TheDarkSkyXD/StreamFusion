import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Mocks
// ----------------------------------------------------------------------------
// The Streamlabs token test scope intentionally avoids electron-store's
// real filesystem behavior — we want to assert the StorageService wiring,
// not test electron-store. We provide a tiny in-memory Map-backed stub
// matching the read/write API surface StorageService uses
// (get / set / delete / clear / path).
//
// `electron.safeStorage` is mocked to take the dev-mode fallback path:
// `isEncryptionAvailable()` returns false, so encryptToken/decryptToken
// round-trip through a base64 fallback (see storage-service.ts).
//
// `dbService` is mocked because storage-service.ts imports it at module
// load time, which would otherwise force better-sqlite3's native module
// to load — and it's compiled for Electron, not for Node under vitest.
// ============================================================================

// Backing stores, keyed by `store name` so two StorageService instances
// using the same store-name share state (simulates persistence across
// restarts).
const backingStores = new Map<string, Map<string, unknown>>();

function getBackingStore(name: string): Map<string, unknown> {
  let s = backingStores.get(name);
  if (!s) {
    s = new Map();
    backingStores.set(name, s);
  }
  return s;
}

vi.mock("electron-store", () => {
  // Mirrors just the slice of electron-store's API that StorageService
  // uses: get(key) with defaults fallback, set(key, value), delete(key),
  // clear(), and the `.path` getter.
  class FakeStore<T extends Record<string, unknown>> {
    private backing: Map<string, unknown>;
    private defaults: Partial<T>;
    public name: string;

    constructor(opts: { name: string; defaults?: Partial<T> }) {
      this.name = opts.name;
      this.defaults = opts.defaults ?? {};
      this.backing = getBackingStore(opts.name);
      // Seed defaults on first construction for this store name.
      for (const [k, v] of Object.entries(this.defaults)) {
        if (!this.backing.has(k)) {
          this.backing.set(k, v);
        }
      }
    }

    get(key: string): unknown {
      if (this.backing.has(key)) {
        return this.backing.get(key);
      }
      return (this.defaults as Record<string, unknown>)[key];
    }

    set(key: string, value: unknown): void {
      this.backing.set(key, value);
    }

    delete(key: string): void {
      this.backing.delete(key);
    }

    clear(): void {
      this.backing.clear();
    }

    get path(): string {
      return `<fake>/${this.name}.json`;
    }
  }
  return { default: FakeStore };
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8"),
  },
  app: {
    getPath: () => "/tmp/streamforge-test",
    getName: () => "streamfusion-test",
  },
}));

vi.mock("@/backend/services/database-service", () => ({
  dbService: {
    getAllFollows: () => [],
    getFollowsByPlatform: () => [],
    getFollowsByPlatformAndSource: () => [],
    hasAccountFollows: () => false,
    addFollow: () => null,
    removeFollow: () => false,
    isFollowing: () => false,
    clearFollowsByPlatformAndSource: () => {},
    clearFollowsByPlatform: () => {},
    clearFollows: () => {},
    clearKeyValue: () => {},
  },
}));

// Imports must come AFTER vi.mock calls so the mocks are wired up.
import { storageService } from "@/backend/services/storage-service";
import type { StreamlabsAuthToken } from "@/shared/auth-types";

const STORE_NAME = "streamfusion-storage";

beforeEach(() => {
  // Wipe persistent backing state before each test for isolation.
  backingStores.clear();
  // The exported singleton was already initialized in a prior test run if
  // any — reset its `.store` reference so initialize() re-runs against the
  // freshly-cleared backing store.
  // biome-ignore lint/suspicious/noExplicitAny: reaching into singleton for test isolation
  (storageService as any).store = null;
  // biome-ignore lint/suspicious/noExplicitAny: reset cache too
  (storageService as any).tokenCache?.clear?.();
  storageService.initialize();
});

afterEach(() => {
  backingStores.clear();
});

describe("StorageService Streamlabs token", () => {
  it("set/get round-trip returns the same token (incl. socketToken)", () => {
    const token: StreamlabsAuthToken = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 123456,
      socketToken: "sock-1",
    };

    storageService.setStreamlabsToken(token);
    const got = storageService.getStreamlabsToken();

    expect(got).toEqual(token);
  });

  it("getStreamlabsToken returns null after clearStreamlabsToken", () => {
    storageService.setStreamlabsToken({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 123456,
      socketToken: "sock-1",
    });
    expect(storageService.getStreamlabsToken()).not.toBeNull();

    storageService.clearStreamlabsToken();
    expect(storageService.getStreamlabsToken()).toBeNull();
  });

  it("getStreamlabsToken returns null when no token has ever been set", () => {
    // beforeEach already wiped backing state and re-initialized the service.
    expect(storageService.getStreamlabsToken()).toBeNull();
  });

  it("persists the token across distinct StorageService instances sharing the same store name", async () => {
    // Instance A writes a token.
    storageService.setStreamlabsToken({
      accessToken: "persist-access",
      refreshToken: "persist-refresh",
      expiresAt: 999000,
      socketToken: "persist-sock",
    });

    // Construct a fresh, second instance against the same backing store
    // (electron-store mock keys by `name`, defaulting to the same
    // "streamfusion-storage").
    //
    // Pull the class out of the module via require to avoid touching the
    // singleton. We re-import the module's source path and instantiate a
    // sibling class to simulate a restart.
    const mod = await import("@/backend/services/storage-service");
    // biome-ignore lint/suspicious/noExplicitAny: singleton's constructor isn't exported; clone via prototype.
    const StorageServiceCtor = (mod.storageService as any).constructor as new () => {
      initialize: () => void;
      getStreamlabsToken: () => StreamlabsAuthToken | null;
    };
    const instanceB = new StorageServiceCtor();
    instanceB.initialize();

    const got = instanceB.getStreamlabsToken();
    expect(got).toEqual({
      accessToken: "persist-access",
      refreshToken: "persist-refresh",
      expiresAt: 999000,
      socketToken: "persist-sock",
    });
  });
});
