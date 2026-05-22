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
    hasAccountFollows: vi.fn(),
    getFollowsByPlatformAndSource: vi.fn(),
  },
}));

import { storageService } from "@/backend/services/storage-service";
import { dbService } from "@/backend/services/database-service";

const accountRows = [
  { id: "r1", platform: "kick", channelId: "411439", channelName: "summit1g", source: "account" },
];
const guestRows = [
  { id: "r2", platform: "kick", channelId: "550022", channelName: "tazo", source: "guest" },
];

beforeEach(() => {
  storageService.initialize();
  vi.mocked(dbService.hasAccountFollows).mockReturnValue(false);
  vi.mocked(dbService.getFollowsByPlatformAndSource).mockImplementation(
    (_p, source) => (source === "account" ? accountRows : guestRows)
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("storageService.getActiveFollowsByPlatform — A5 token-aware contract", () => {
  it("no token + stale account rows: returns GUEST follows (the A5 regression guard)", () => {
    // Before A5, the function returned account rows whenever hasAccountFollows
    // was true — even after a silent token loss. Sign-out followed by a crash
    // mid-clearToken would leave a user seeing the prior account's follow
    // list with no live session. The fix gates on hasToken first.
    vi.spyOn(storageService, "hasToken").mockReturnValue(false);
    vi.mocked(dbService.hasAccountFollows).mockReturnValue(true);

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(guestRows);
    // Critical: dbService must NOT have been asked for account rows when
    // there's no token, even if they exist.
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith(
      "kick",
      "guest"
    );
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith(
      "kick",
      "account"
    );
  });

  it("token + account rows: returns ACCOUNT follows", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    vi.mocked(dbService.hasAccountFollows).mockReturnValue(true);

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(accountRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith(
      "kick",
      "account"
    );
  });

  it("token + no account rows yet: returns GUEST follows (sync-pending fallback)", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    vi.mocked(dbService.hasAccountFollows).mockReturnValue(false);

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual(guestRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith(
      "kick",
      "guest"
    );
  });
});
