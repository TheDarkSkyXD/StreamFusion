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

const accountRows = [
  { id: "r1", platform: "kick", channelId: "411439", channelName: "summit1g", source: "account" },
];
const localRows = [
  { id: "r3", platform: "kick", channelId: "777001", channelName: "loco", source: "local" },
];
const guestRows = [
  { id: "r2", platform: "kick", channelId: "550022", channelName: "tazo", source: "guest" },
];

// Per-source DB contents the mocked dbService returns. Each test sets the
// buckets it cares about; getActiveFollowsByPlatform reads them by source.
let rowsBySource: Record<string, any[]>;

beforeEach(() => {
  storageService.initialize();
  rowsBySource = { account: [], local: [], guest: [] };
  vi.mocked(dbService.getFollowsByPlatformAndSource).mockImplementation(
    (_p, source) => rowsBySource[source] ?? []
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("storageService.getActiveFollowsByPlatform — token-aware account ∪ local contract", () => {
  it("no token: returns GUEST follows only, hiding account AND local rows (A5 guard + signed-out hiding)", () => {
    // Before A5, the function returned account rows whenever they existed —
    // even after a silent token loss. The fix gates on hasToken first. local
    // rows are likewise hidden while signed out (they reappear on re-login).
    vi.spyOn(storageService, "hasToken").mockReturnValue(false);
    rowsBySource = { account: accountRows, local: localRows, guest: guestRows };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(guestRows);
    // Critical: dbService must NOT have been asked for account or local rows
    // when there's no token, even if they exist.
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("kick", "guest");
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith("kick", "account");
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith("kick", "local");
  });

  it("token + account rows only: returns ACCOUNT follows", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { account: accountRows, local: [], guest: guestRows };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(accountRows);
  });

  it("token + local rows only: returns LOCAL follows (re-login surfaces them again)", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { account: [], local: localRows, guest: guestRows };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(localRows);
  });

  it("token + both account and local (distinct channels): returns the union", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { account: accountRows, local: localRows, guest: guestRows };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual([...accountRows, ...localRows]);
  });

  it("token + same channel in account AND local: dedupes to one, account preferred", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    // Same channel (411439 / summit1g) in both buckets; the local copy must be
    // dropped in favor of the account row.
    const dupLocal = [
      { id: "r9", platform: "kick", channelId: "411439", channelName: "summit1g", source: "local" },
    ];
    rowsBySource = { account: accountRows, local: dupLocal, guest: guestRows };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(accountRows);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("account");
  });

  it("dedupes via the slug bridge when the local row carries a different (stale) channelId", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    // Account row id 411439; the local row for the same channel carries a
    // stale numeric id but the same channelName — the case-insensitive name
    // match must still collapse them (the dual-id rule).
    const staleLocal = [
      { id: "r9", platform: "kick", channelId: "421500", channelName: "SUMMIT1G", source: "local" },
    ];
    rowsBySource = { account: accountRows, local: staleLocal, guest: guestRows };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(accountRows);
  });

  it("token + neither account nor local rows yet: returns GUEST follows (sync-pending fallback)", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { account: [], local: [], guest: guestRows };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(guestRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("kick", "guest");
  });
});
