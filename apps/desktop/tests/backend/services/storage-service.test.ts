import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persistence = vi.hoisted(() => ({
  electronData: null as Record<string, unknown> | null,
  electronDefaults: {} as Record<string, unknown>,
  electronReplacements: 0,
  sqlite: new Map<string, unknown>(),
  sqliteFollows: [] as LocalFollow[],
}));

// Electron and electron-store are not available in the vitest node runtime.
// Mock the surfaces storage-service needs before importing the module.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn((s: string) => Buffer.from(`encrypted:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString("utf8").replace(/^encrypted:/, "")),
  },
}));

vi.mock("electron-store", () => ({
  default: class MockStore {
    constructor(opts: { defaults?: Record<string, unknown> } = {}) {
      persistence.electronDefaults = { ...opts.defaults };
      persistence.electronData ??= { ...opts.defaults };
    }
    get(key: string, fallback?: unknown) {
      const data = persistence.electronData ?? {};
      return key in data ? data[key] : fallback;
    }
    set(key: string, value: unknown) {
      const data = persistence.electronData ?? {};
      data[key] = value;
      persistence.electronData = data;
    }
    delete(key: string) {
      const data = persistence.electronData ?? {};
      delete data[key];
      persistence.electronData = data;
    }
    clear() {
      persistence.electronData = { ...persistence.electronDefaults };
      persistence.electronReplacements += 1;
    }
    get store() {
      return { ...(persistence.electronData ?? {}) };
    }
    set store(value: Record<string, unknown>) {
      persistence.electronData = { ...value };
      persistence.electronReplacements += 1;
    }
    get path() {
      return "streamfusion-storage.json";
    }
  },
}));

vi.mock("@backend/services/database-service", () => ({
  dbService: {
    get: vi.fn(),
    set: vi.fn(),
    getJson: vi.fn(),
    delete: vi.fn(),
    migrateKeyValues: vi.fn(),
    clearKeyValue: vi.fn(),
    clearFollows: vi.fn(),
    addFollow: vi.fn(),
    getAllFollows: vi.fn(),
    getFollowsByPlatformAndSource: vi.fn(),
    upsertSyncedFollows: vi.fn(),
    updatePendingFollowWriteState: vi.fn(),
  },
}));

import { dbService } from "@backend/services/database-service";
import { StorageService, storageService } from "@backend/services/storage-service";
import { safeStorage } from "electron";
import { createStreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import {
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
} from "@shared/auth-types";
import type { DownloadQueueSnapshot } from "@shared/download-types";
import type { StreamRecordingJournalV2 } from "@shared/stream-recording-types";
import type { LocalFollow } from "@shared/auth-types";

const kickPlatformRows: LocalFollow[] = [
  {
    id: "r1",
    platform: "kick",
    channelId: "411439",
    channelName: "summit1g",
    displayName: "summit1g",
    profileImage: "",
    followedAt: "2026-01-01T00:00:00.000Z",
    source: "kick",
  },
];
const kickGuestRows: LocalFollow[] = [
  {
    id: "r2",
    platform: "kick",
    channelId: "550022",
    channelName: "tazo",
    displayName: "tazo",
    profileImage: "",
    followedAt: "2026-01-01T00:00:00.000Z",
    source: "guest",
  },
];

// Per-source DB contents the mocked dbService returns. Each test sets the
// buckets it cares about; getActiveFollowsByPlatform reads them by source.
let rowsBySource: Record<string, LocalFollow[]>;

beforeEach(() => {
  storageService.initialize();
  persistence.electronData = { ...persistence.electronDefaults };
  persistence.electronReplacements = 0;
  persistence.sqlite.clear();
  persistence.sqliteFollows = [];
  rowsBySource = { guest: [], kick: [], twitch: [] };
  vi.mocked(dbService.getFollowsByPlatformAndSource).mockImplementation(
    (_p, source) => rowsBySource[source] ?? []
  );
  vi.spyOn(storageService, "getKickUser").mockReturnValue({
    id: 1,
    username: "viewer-a",
    slug: "viewer-a",
    profilePic: "",
    verified: false,
  });
  vi.mocked(dbService.get).mockImplementation((key, parse) => {
    if (key === "kick-account-follows-verified-v3") return "1:viewer-a";
    if (!persistence.sqlite.has(key)) return null;
    return parse(persistence.sqlite.get(key));
  });
  vi.mocked(dbService.getJson).mockImplementation((key) =>
    persistence.sqlite.has(key)
      ? { kind: "value", value: persistence.sqlite.get(key) }
      : { kind: "missing" }
  );
  vi.mocked(dbService.set).mockImplementation((key, value) => {
    persistence.sqlite.set(key, value);
  });
  vi.mocked(dbService.delete).mockImplementation((key) => {
    persistence.sqlite.delete(key);
  });
  vi.mocked(dbService.migrateKeyValues).mockImplementation(
    ({ entries, deleteKeys, legacyFollows = [] }) => {
      for (const { key, value } of entries) {
        if (!persistence.sqlite.has(key)) persistence.sqlite.set(key, value);
      }
      for (const key of deleteKeys) persistence.sqlite.delete(key);
      for (const follow of legacyFollows) {
        if (!persistence.sqliteFollows.some(({ id }) => id === follow.id)) {
          persistence.sqliteFollows.push(follow);
        }
      }
    }
  );
  vi.mocked(dbService.upsertSyncedFollows).mockReturnValue({
    accountCount: 0,
    pendingCount: 0,
    addedCount: 0,
    removedCount: 0,
  });
  vi.mocked(dbService.getAllFollows).mockReturnValue([]);
  vi.mocked(dbService.addFollow).mockImplementation((follow, source) => ({
    id: follow.id ?? `${follow.platform}:${follow.channelId}`,
    platform: follow.platform,
    channelId: follow.channelId,
    channelName: follow.channelName,
    displayName: follow.displayName ?? follow.channelName,
    profileImage: follow.profileImage ?? "",
    followedAt: follow.followedAt ?? "2026-01-01T00:00:00.000Z",
    source: source ?? "guest",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("token + unverified Kick account rows: returns [] instead of stale source=kick rows", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    vi.mocked(dbService.get).mockReturnValue(null);
    rowsBySource = { guest: kickGuestRows, kick: kickPlatformRows, twitch: [] };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual([]);
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith("kick", "kick");
  });

  it("token + no platform-tagged rows yet: returns [] instead of guest follows", () => {
    // Signed-in account views must not surface guest/local follows as though
    // the platform account follows them.
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { guest: kickGuestRows, kick: [], twitch: [] };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual([]);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("kick", "kick");
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith("kick", "guest");
  });

  it("token + neither platform-tagged nor guest rows: returns []", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    rowsBySource = { guest: [], kick: [], twitch: [] };

    const result = storageService.getActiveFollowsByPlatform("kick");

    expect(result).toEqual([]);
  });

  it("scopes the per-platform lookup — twitch query reads twitch buckets, not kick", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    const twitchRows: LocalFollow[] = [
      {
        id: "tx",
        platform: "twitch",
        channelId: "12345",
        channelName: "alice",
        displayName: "alice",
        profileImage: "",
        followedAt: "2026-01-01T00:00:00.000Z",
        source: "twitch",
      },
    ];
    rowsBySource = { guest: kickGuestRows, kick: kickPlatformRows, twitch: twitchRows };

    const result = storageService.getActiveFollowsByPlatform("twitch");

    expect(result).toEqual(twitchRows);
    expect(dbService.getFollowsByPlatformAndSource).toHaveBeenCalledWith("twitch", "twitch");
    expect(dbService.getFollowsByPlatformAndSource).not.toHaveBeenCalledWith("twitch", "kick");
  });

  it("marks Kick account follows verified after a successful sync", () => {
    storageService.upsertSyncedFollows("kick", []);

    expect(dbService.set).toHaveBeenCalledWith("kick-account-follows-verified-v3", "1:viewer-a");
  });

  it("does not trust the obsolete v2 marker", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    vi.mocked(dbService.get).mockImplementation((key) =>
      key === "kick-account-follows-verified-v2" ? true : null
    );
    rowsBySource = { guest: [], kick: kickPlatformRows, twitch: [] };

    expect(storageService.getActiveFollowsByPlatform("kick")).toEqual([]);
  });

  it("does not expose v3 rows verified for a different Kick account", () => {
    vi.spyOn(storageService, "hasToken").mockReturnValue(true);
    vi.spyOn(storageService, "getKickUser").mockReturnValue({
      id: 2,
      username: "viewer-b",
      slug: "viewer-b",
      profilePic: "",
      verified: false,
    });
    vi.mocked(dbService.get).mockReturnValue("1:viewer-a");
    rowsBySource = { guest: [], kick: kickPlatformRows, twitch: [] };

    expect(storageService.getActiveFollowsByPlatform("kick")).toEqual([]);
  });
});

// Guards: follow metadata repair must preserve account-vs-guest source when rewriting stale Kick rows.
describe("storageService.updateLocalFollow", () => {
  it("passes the current row source through to the DB upsert", () => {
    const current: LocalFollow = {
      id: "kick-account-row",
      platform: "kick",
      channelId: "old-slug",
      channelName: "old-slug",
      displayName: "Old Slug",
      profileImage: "",
      followedAt: "2026-01-01T00:00:00.000Z",
      source: "kick",
    };
    vi.mocked(dbService.getAllFollows).mockReturnValue([current]);

    const result = storageService.updateLocalFollow("kick-account-row", {
      channelId: "123",
      channelName: "new-slug",
    });

    expect(dbService.addFollow).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "kick-account-row",
        channelId: "123",
        channelName: "new-slug",
        source: "kick",
      }),
      "kick"
    );
    expect(result?.source).toBe("kick");
  });
});

// Guards: pending retry-state changes remain SQLite-owned behind the StorageService facade.
describe("storageService pending follow writes", () => {
  it("delegates retry-state updates to DatabaseService", () => {
    vi.mocked(dbService.updatePendingFollowWriteState).mockReturnValue(true);

    const result = storageService.updatePendingFollowWriteState({
      platform: "kick",
      channelId: "ramees",
      slug: "ramees",
      action: "follow",
      status: "retrying",
      attemptedAt: new Date("2026-07-04T03:20:01.000Z"),
      nextAttemptAt: new Date("2026-07-04T03:20:03.000Z"),
      attemptCount: 1,
      lastError: "network-error",
    });

    expect(result).toBe(true);
    expect(dbService.updatePendingFollowWriteState).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "ramees",
      slug: "ramees",
      action: "follow",
      status: "retrying",
      attemptedAt: new Date("2026-07-04T03:20:01.000Z"),
      nextAttemptAt: new Date("2026-07-04T03:20:03.000Z"),
      attemptCount: 1,
      lastError: "network-error",
    });
  });
});

// Guards: the legacy Twitch follow credential is encrypted separately from normal Twitch auth.
describe("storageService Twitch follow-write token", () => {
  it("round-trips and clears the separately encrypted token without overwriting normal auth", () => {
    const normalToken = { accessToken: "normal-token", scope: ["user:read:follows"] };
    const followWriteToken = {
      accessToken: "follow-write-token",
      scope: ["user_follows_edit"],
    };
    storageService.saveToken("twitch", normalToken);

    storageService.saveTwitchFollowWriteToken(followWriteToken);

    expect(storageService.getTwitchFollowWriteToken()).toEqual(followWriteToken);
    expect(storageService.getToken("twitch")).toEqual(normalToken);
    expect(vi.mocked(safeStorage.encryptString)).toHaveBeenCalledWith(
      JSON.stringify(followWriteToken)
    );

    storageService.clearTwitchFollowWriteToken();

    expect(storageService.getTwitchFollowWriteToken()).toBeNull();
    expect(storageService.getToken("twitch")).toEqual(normalToken);
    storageService.clearToken("twitch");
  });

  it("removes the dedicated credential when all tokens are cleared", () => {
    storageService.saveTwitchFollowWriteToken({
      accessToken: "follow-write-token",
      scope: ["user_follows_edit"],
    });

    storageService.clearAllTokens();

    expect(storageService.getTwitchFollowWriteToken()).toBeNull();
  });
});

// Guards: Kick's page-context bearer survives process restarts and OAuth-only invalidation in its own encrypted envelope.
describe("storageService Kick web bearer", () => {
  it("round-trips securely and is independent from OAuth token clearing", () => {
    storageService.saveKickWebBearer("Bearer 123|restartproof");

    expect(storageService.getKickWebBearer()).toBe("Bearer 123|restartproof");
    expect(vi.mocked(safeStorage.encryptString)).toHaveBeenCalledWith("Bearer 123|restartproof");

    storageService.clearToken("twitch");
    expect(storageService.getKickWebBearer()).toBe("Bearer 123|restartproof");

    storageService.clearToken("kick");
    expect(storageService.getKickWebBearer()).toBe("Bearer 123|restartproof");

    storageService.clearKickWebBearer();
    expect(storageService.getKickWebBearer()).toBeNull();
  });

  it("is removed by the explicit clear-all operation", () => {
    storageService.saveKickWebBearer("Bearer 123|restartproof");

    storageService.clearAllTokens();

    expect(storageService.getKickWebBearer()).toBeNull();
  });
});

// Guards: canonical regional display languages survive the durable preference round-trip.
// Guards: main-process consumers are notified when display-language preferences change.
describe("storageService display-language preferences", () => {
  it("persists a regional display language", () => {
    storageService.updatePreferences({ language: "pt-PT" });

    expect(storageService.getPreferences().language).toBe("pt-PT");
  });

  it("notifies and can unsubscribe preference consumers", () => {
    const listener = vi.fn();
    const unsubscribe = storageService.onPreferencesChanged(listener);

    storageService.updatePreferences({ language: "es" });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ language: "es" }));

    unsubscribe();
    storageService.updatePreferences({ language: "en" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("storageService.getPreferences - buffer defaults migration", () => {
  it("migrates the exact legacy latency-first buffer defaults to the stable defaults", () => {
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      buffer: {
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        maxBufferLengthSec: 15,
        maxMaxBufferLengthSec: 30,
      },
    });

    expect(storageService.getPreferences().buffer).toEqual(DEFAULT_BUFFER_PREFERENCES);
  });

  it("preserves custom user buffer settings", () => {
    const customBuffer = {
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      maxBufferLengthSec: 20,
      maxMaxBufferLengthSec: 45,
    };
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      buffer: customBuffer,
    });

    expect(storageService.getPreferences().buffer).toEqual(customBuffer);
  });
});

describe("storageService.getPreferences - notification defaults migration", () => {
  it("hydrates new nested notification fields for installs with the legacy notification group", () => {
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      notifications: {
        enabled: false,
        liveAlerts: true,
        sound: false,
        favoriteChannelsOnly: true,
      },
    } as typeof DEFAULT_USER_PREFERENCES);

    expect(storageService.getPreferences().notifications).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled: false,
      sound: false,
      favoriteChannelsOnly: true,
    });
  });
});

// Guards: legacy chat display choices must survive newly added display preferences during hydration.
describe("storageService.getPreferences - chat display defaults migration", () => {
  it("preserves legacy chat display choices while hydrating newly added fields", () => {
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      chatDisplay: {
        boldUsernames: true,
        timestamps: true,
        density: "compact",
      },
    } as typeof DEFAULT_USER_PREFERENCES);

    expect(storageService.getPreferences().chatDisplay).toEqual({
      ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
      boldUsernames: true,
      timestamps: true,
      density: "compact",
    });
  });

  it("preserves explicitly disabled newly added toggles", () => {
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      chatDisplay: {
        hoverSmooth: false,
        quickEmotes: false,
      },
    } as typeof DEFAULT_USER_PREFERENCES);

    expect(storageService.getPreferences().chatDisplay).toEqual({
      ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
      hoverSmooth: false,
      quickEmotes: false,
    });
  });
});

// Guards: Downloads queue snapshots survive service consumers through the typed persistent store contract.
describe("storageService download queue persistence", () => {
  it("saves and reloads the complete Downloads queue snapshot", () => {
    const snapshot: DownloadQueueSnapshot = {
      jobs: [
        {
          id: "clip-job-1",
          kind: "clip",
          platform: "kick",
          sourceId: "clip-1",
          title: "Clip",
          channelName: "streamer",
          status: "paused",
          progress: { percent: 25, transferredBytes: 250, totalBytes: 1000 },
          destinationPath: "D:/Videos/clip.mp4",
          createdAt: "2026-07-31T10:00:00.000Z",
          updatedAt: "2026-07-31T10:01:00.000Z",
        },
      ],
    };

    storageService.saveDownloadQueue(snapshot);

    expect(storageService.getDownloadQueue()).toEqual(snapshot);
  });
});

// Guards: the last selected clip or VOD folder persists through the main-owned storage contract.
describe("storageService download directory persistence", () => {
  it("saves and reloads the last selected download directory", () => {
    expect(storageService.getLastDownloadDirectory()).toBeNull();

    storageService.saveLastDownloadDirectory("D:/Media");

    expect(storageService.getLastDownloadDirectory()).toBe("D:/Media");
  });
});

// Guards: Recording startup can hydrate an empty V2 journal and persist later session state.
describe("storageService Stream Recording journal persistence", () => {
  it("provides the default V2 journal and round-trips an active session", () => {
    const sessionStore = createStreamRecordingSessionStore({ storage: storageService });

    expect(sessionStore.getJournal()).toEqual({
      version: 2,
      state: "empty",
      session: null,
    });

    const journal: StreamRecordingJournalV2 = {
      version: 2,
      state: "active",
      session: {
        id: "recording-session-1",
        platform: "twitch",
        channelName: "streamer",
        title: "Live stream",
        status: "recording",
        destinationPath: "D:/Videos/streamer",
        qualityLabel: "Source",
        capturedDurationSeconds: 12,
        sections: [],
        gaps: [],
        createdAt: "2026-08-02T16:49:00.000Z",
        updatedAt: "2026-08-02T16:49:12.000Z",
      },
    };

    storageService.saveStreamRecordingJournal(journal);

    expect(storageService.getStreamRecordingJournal()).toEqual(journal);
  });
});

// Guards: growing renderer records and operational state belong to row-scoped SQLite storage, never the shared Electron Store JSON document.
describe("storageService persistence ownership", () => {
  it("routes generic renderer records to SQLite", () => {
    const key = "browse-query-snapshot:v1:top-streams:all";
    const snapshot = { streams: [{ id: "stream-1" }] };

    storageService.set(key, snapshot);

    expect(dbService.set).toHaveBeenCalledWith(`renderer-store:${key}`, snapshot);
  });

  it("routes typed operational records to SQLite", () => {
    const downloadQueue: DownloadQueueSnapshot = { jobs: [] };
    const recordingJournal: StreamRecordingJournalV2 = {
      version: 2,
      state: "empty",
      session: null,
    };

    storageService.saveKickApiRateLimitState({ blockedUntil: 1234 });
    storageService.saveKickFollowedStreamsCache({ cachedAt: 5678, streams: [] });
    storageService.saveDownloadQueue(downloadQueue);
    storageService.saveStreamRecordingJournal(recordingJournal);

    expect(dbService.set).toHaveBeenCalledWith("operational:kickApiRateLimit", {
      blockedUntil: 1234,
    });
    expect(dbService.set).toHaveBeenCalledWith("operational:kickFollowedStreamsCache", {
      cachedAt: 5678,
      streams: [],
    });
    expect(dbService.set).toHaveBeenCalledWith("operational:downloadQueue", downloadQueue);
    expect(dbService.set).toHaveBeenCalledWith(
      "operational:streamRecordingJournal",
      recordingJournal
    );
  });

  it("distinguishes a missing renderer record from stored null", () => {
    storageService.set("recent-stream", null);

    expect(storageService.get("recent-stream")).toBeNull();
    expect(storageService.get("missing-stream")).toBeUndefined();
  });

  it("rejects protected and malformed generic keys", () => {
    expect(() => storageService.get("authTokens")).toThrow(/protected key/);
    expect(() => storageService.set("preferences", {})).toThrow(/protected key/);
    expect(() => storageService.delete("windowBounds")).toThrow(/protected key/);
    expect(() => storageService.get(" ")).toThrow(/invalid/);
    expect(() => storageService.get("bad\u0000key")).toThrow(/invalid/);
    expect(() => storageService.get("x".repeat(513))).toThrow(/invalid/);
  });

  it("migrates legacy JSON once and keeps existing SQLite values on restart", () => {
    const existingSnapshot = { streams: [{ id: "sqlite-wins" }] };
    persistence.sqlite.set(
      "renderer-store:browse-query-snapshot:v1:top-streams:all",
      existingSnapshot
    );
    persistence.sqlite.set("authTokens", { leaked: true });
    persistence.sqlite.set("renderer-store:preferences", { leaked: true });
    persistence.electronData = {
      authTokens: { twitch: { encrypted: "ciphertext", encoding: "safeStorage" } },
      twitchUser: {
        id: "1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        broadcasterType: "",
      },
      kickUser: null,
      preferences: DEFAULT_USER_PREFERENCES,
      lastActiveTab: "following",
      windowBounds: { width: 1280, height: 720, isMaximized: false },
      localFollows: [
        {
          id: "legacy-follow",
          platform: "kick",
          channelId: "123",
          channelName: "streamer",
          displayName: "Streamer",
          profileImage: "",
          followedAt: "2025-01-01T00:00:00.000Z",
          source: "guest",
        },
      ],
      downloadQueue: { jobs: [] },
      streamRecordingJournal: { version: 2, state: "empty", session: null },
      "browse-query-snapshot:v1:top-streams:all": { streams: [{ id: "legacy" }] },
    };

    const firstStart = new StorageService();
    firstStart.initialize();

    expect(
      persistence.sqlite.get("renderer-store:browse-query-snapshot:v1:top-streams:all")
    ).toEqual(existingSnapshot);
    expect(persistence.sqlite.get("operational:downloadQueue")).toEqual({ jobs: [] });
    expect(persistence.sqlite.get("operational:streamRecordingJournal")).toEqual({
      version: 2,
      state: "empty",
      session: null,
    });
    expect(persistence.sqlite.has("authTokens")).toBe(false);
    expect(persistence.sqlite.has("renderer-store:preferences")).toBe(false);
    expect(persistence.sqlite.has("renderer-store:localFollows")).toBe(false);
    expect(persistence.sqliteFollows).toEqual([
      {
        id: "legacy-follow",
        platform: "kick",
        channelId: "123",
        channelName: "streamer",
        displayName: "Streamer",
        profileImage: "",
        followedAt: "2025-01-01T00:00:00.000Z",
        source: "guest",
      },
    ]);
    expect(persistence.electronData).toEqual({
      authTokens: { twitch: { encrypted: "ciphertext", encoding: "safeStorage" } },
      appTokens: {},
      twitchUser: {
        id: "1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        broadcasterType: "",
      },
      kickUser: null,
      preferences: DEFAULT_USER_PREFERENCES,
      lastActiveTab: "following",
      windowBounds: { width: 1280, height: 720, isMaximized: false },
    });
    expect(persistence.electronReplacements).toBe(1);

    const secondStart = new StorageService();
    secondStart.initialize();

    expect(persistence.electronReplacements).toBe(1);
    expect(
      persistence.sqlite.get("renderer-store:browse-query-snapshot:v1:top-streams:all")
    ).toEqual(existingSnapshot);
  });

  it("can retry initialization after a failed migration", () => {
    persistence.electronData = {
      ...persistence.electronDefaults,
      "browse-query-snapshot:v1:top-streams:all": { streams: [] },
    };
    vi.mocked(dbService.migrateKeyValues).mockImplementationOnce(() => {
      throw new Error("database busy");
    });
    const service = new StorageService();

    expect(() => service.initialize()).toThrow("database busy");
    expect(() => service.initialize()).not.toThrow();
    expect(dbService.migrateKeyValues).toHaveBeenCalledTimes(2);
    expect(service.getPreferences()).toEqual(DEFAULT_USER_PREFERENCES);
  });
});
