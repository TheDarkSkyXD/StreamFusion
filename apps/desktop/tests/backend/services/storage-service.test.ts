import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Electron and electron-store are not available in the vitest node runtime.
// Mock the surfaces storage-service needs before importing the module.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString("utf8"),
  },
}));

vi.mock("electron-store", () => ({
  default: class MockStore {
    private data: Record<string, unknown>;
    constructor(opts: { defaults?: Record<string, unknown> } = {}) {
      this.data = { ...opts.defaults };
    }
    get(key: string, fallback?: unknown) {
      return key in this.data ? this.data[key] : fallback;
    }
    set(key: string, value: unknown) {
      this.data[key] = value;
    }
  },
}));

vi.mock("@/backend/services/database-service", () => ({
  dbService: {
    getFollowsByPlatformAndSource: vi.fn(),
  },
}));

import { storageService } from "@/backend/services/storage-service";
import { dbService } from "@/backend/services/database-service";

const kickPlatformRows = [
  { id: "r1", platform: "kick", channelId: "411439", channelName: "summit1g", source: "kick" },
];
const kickGuestRows = [
  { id: "r2", platform: "kick", channelId: "550022", channelName: "tazo", source: "guest" },
];

// Per-source DB contents the mocked dbService returns. Each test sets the
// buckets it cares about; getActiveFollowsByPlatform reads them by source.
let rowsBySource: Record<string, any[]>;

beforeEach(() => {
  storageService.initialize();
  rowsBySource = { guest: [], kick: [], twitch: [] };
  vi.mocked(dbService.getFollowsByPlatformAndSource).mockImplementation(
    (_p, source) => rowsBySource[source] ?? []
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("storageService.getActiveFollowsByPlatform — token-aware platform/guest gating", () => {
  it("no token: returns guest follows ONLY (platform-tagged rows stay hidden)", () => {
    // The token check is the source of truth for "is the user signed in?".
    // A silent token loss (revoked at runtime, expired credentials) must NOT
    // continue returning the platform-tagged rows that belong to the dead session.
    vi.spyOn(storageService, "hasToken").mockReturnValue(false);
    rowsBySource = { guest: kickGuestRows, kick: kickPlatformRows, twitch: [] };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(kickGuestRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("kick", "guest");
    // dbService must NOT be asked for platform-tagged rows in the no-token branch.
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith("kick", "kick");
  });

  it("token + platform-tagged rows present: returns platform-tagged rows", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { guest: kickGuestRows, kick: kickPlatformRows, twitch: [] };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(kickPlatformRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("kick", "kick");
  });

  it("token + no platform-tagged rows yet: falls back to guest follows (fresh-login bridge)", () => {
    // Token present but no kick-source rows yet (fresh login mid-sync, or a
    // sync that returned empty/error). Surface guest follows so the sidebar
    // isn't briefly empty during the import window.
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { guest: kickGuestRows, kick: [], twitch: [] };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(kickGuestRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("kick", "kick");
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("kick", "guest");
  });

  it("token + neither platform-tagged nor guest rows: returns []", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { guest: [], kick: [], twitch: [] };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual([]);
  });

  it("scopes the per-platform lookup — twitch query reads twitch buckets, not kick", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    const twitchRows = [
      { id: "tx", platform: "twitch", channelId: "12345", channelName: "alice", source: "twitch" },
    ];
    rowsBySource = { guest: kickGuestRows, kick: kickPlatformRows, twitch: twitchRows };

    const result = storageService.getActiveFollowsByPlatform("twitch");

    expect(result).toEqual(twitchRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("twitch", "twitch");
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith("twitch", "kick");
  });
});
