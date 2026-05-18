import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The repo ships better-sqlite3 compiled for Electron (NODE_MODULE_VERSION 133).
// Vitest runs under system Node (137), so the native binding fails to load
// unless the developer has run `npm rebuild better-sqlite3`. Skip gracefully
// when the binary is mismatched so the rest of the test suite stays green.
// To run these tests: `npm rebuild better-sqlite3 && npm test ...` then
// `npm run rebuild-deps` to restore the Electron-targeted binary.
const SQLITE_AVAILABLE = (() => {
  try {
    new Database(":memory:").close();
    return true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: surfacing skip reason
    console.warn(
      "[database-service.test] better-sqlite3 native binary mismatch — skipping. " +
        "Run `npm rebuild better-sqlite3` to run these tests."
    );
    return false;
  }
})();

const describeDb = SQLITE_AVAILABLE ? describe : describe.skip;

// A fresh temp directory per test so each DatabaseService instance
// initializes its own SQLite file at <tmp>/streamfusion.db.
let currentTmpDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: (_kind: string) => currentTmpDir,
  },
}));

// Import after the mock is in place.
import { DatabaseService } from "@/backend/services/database-service";

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "streamforge-dbtest-"));
  return dir;
}

beforeEach(() => {
  currentTmpDir = makeTmpDir();
});

afterEach(() => {
  // Best-effort cleanup of the per-test temp directory.
  try {
    fs.rmSync(currentTmpDir, { recursive: true, force: true });
  } catch {
    // ignore — Windows may hold a file briefly
  }
});

describeDb("DatabaseService schema", () => {
  it("creates mod_log, kick_automod_config, and retention_settings on first initialize() and is idempotent on a second call", () => {
    const svc = new DatabaseService();
    svc.initialize();
    // Second call must not throw or duplicate any state.
    expect(() => svc.initialize()).not.toThrow();

    // Reach into the DB file directly to confirm the tables exist.
    const dbPath = path.join(currentTmpDir, "streamfusion.db");
    const raw = new Database(dbPath, { readonly: true });
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    raw.close();

    expect(names).toEqual(
      expect.arrayContaining([
        "key_value",
        "local_follows",
        "mod_log",
        "kick_automod_config",
        "retention_settings",
      ])
    );
  });

  it("preserves existing key_value + local_follows data when migrating from a prior-version DB that only had those two tables", () => {
    // Build an old-style DB by hand at the expected path.
    const dbPath = path.join(currentTmpDir, "streamfusion.db");
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE key_value (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE local_follows (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        display_name TEXT,
        profile_image TEXT,
        followed_at TEXT,
        source TEXT NOT NULL DEFAULT 'guest',
        UNIQUE(platform, channel_id, source)
      );
      INSERT INTO key_value (key, value) VALUES ('greeting', '"hi"');
      INSERT INTO local_follows (id, platform, channel_id, channel_name, source)
        VALUES ('twitch-acct-12345-1', 'twitch', '12345', 'somechannel', 'account');
    `);
    old.close();

    const svc = new DatabaseService();
    svc.initialize();

    // Existing key_value content survives.
    expect(svc.get<string>("greeting")).toBe("hi");

    // Existing follows survive.
    const follows = svc.getAllFollows();
    expect(follows).toHaveLength(1);
    expect(follows[0]).toMatchObject({
      platform: "twitch",
      channelId: "12345",
      source: "account",
    });

    // New tables were created.
    const raw = new Database(dbPath, { readonly: true });
    const names = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    raw.close();
    expect(names).toEqual(
      expect.arrayContaining(["mod_log", "kick_automod_config", "retention_settings"])
    );
  });
});

describeDb("DatabaseService mod_log helpers", () => {
  it("round-trips insertModLog → queryModLog with newest-first deterministic ordering", () => {
    const svc = new DatabaseService();
    svc.initialize();

    const base = 1_700_000_000_000;
    svc.insertModLog({
      channelId: "c1",
      channelSlug: "chan-one",
      action: "timeout",
      targetUserId: "u1",
      targetUsername: "alice",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      durationSeconds: 600,
      reason: "spam",
      createdAt: base,
    });
    svc.insertModLog({
      channelId: "c1",
      channelSlug: "chan-one",
      action: "ban",
      targetUserId: "u2",
      targetUsername: "bob",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      durationSeconds: null,
      reason: null,
      createdAt: base + 1_000,
    });
    // Different channel — should not appear in c1 query results.
    svc.insertModLog({
      channelId: "c2",
      channelSlug: "chan-two",
      action: "ban",
      targetUserId: "u3",
      targetUsername: "carol",
      moderatorUserId: "m2",
      moderatorUsername: "modB",
      createdAt: base + 2_000,
    });

    const rows = svc.queryModLog({ channelId: "c1" });
    expect(rows.map((r) => r.targetUsername)).toEqual(["bob", "alice"]);
    expect(rows[0].durationSeconds).toBeNull();
    expect(rows[1].durationSeconds).toBe(600);

    const targetFiltered = svc.queryModLog({ channelId: "c1", targetUserId: "u1" });
    expect(targetFiltered).toHaveLength(1);
    expect(targetFiltered[0].targetUsername).toBe("alice");

    const actionFiltered = svc.queryModLog({ channelId: "c1", action: "ban" });
    expect(actionFiltered).toHaveLength(1);
    expect(actionFiltered[0].targetUserId).toBe("u2");

    const modFiltered = svc.queryModLog({ channelId: "c1", moderatorUsername: "modA" });
    expect(modFiltered).toHaveLength(2);
  });

  it("AE10: sweepModLogRetention deletes entries older than the global retention window while keeping fresher ones", () => {
    const svc = new DatabaseService();
    svc.initialize();

    const now = 1_700_000_000_000;
    const day = 86_400_000;

    // 5 entries spanning 40 days back.
    for (let i = 0; i < 5; i++) {
      svc.insertModLog({
        channelId: "c1",
        channelSlug: "chan-one",
        action: "timeout",
        targetUserId: `u${i}`,
        targetUsername: `user-${i}`,
        moderatorUserId: "m1",
        moderatorUsername: "modA",
        createdAt: now - i * 10 * day, // 0d, 10d, 20d, 30d, 40d ago
      });
    }

    svc.setRetentionSetting("global", 30);

    const deleted = svc.sweepModLogRetention(now);
    // Only the 40d-old entry is strictly older than 30 days.
    expect(deleted).toBe(1);

    const remaining = svc.queryModLog({ channelId: "c1", limit: 100 });
    expect(remaining).toHaveLength(4);
    expect(remaining.map((r) => r.targetUserId)).toEqual(["u0", "u1", "u2", "u3"]);
  });

  it("sweepModLogRetention honors a channel-scoped override over the global setting", () => {
    const svc = new DatabaseService();
    svc.initialize();

    const now = 2_000_000_000_000;
    const day = 86_400_000;

    // Channel c1: keep an entry 20 days old. Channel-specific 10-day window
    // should remove it; global 60-day window would have kept it.
    svc.insertModLog({
      channelId: "c1",
      channelSlug: "chan-one",
      action: "timeout",
      targetUserId: "u1",
      targetUsername: "alice",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      createdAt: now - 20 * day,
    });
    // Channel c2: keep an entry 40 days old. Global 60-day window keeps it
    // (no channel-specific override).
    svc.insertModLog({
      channelId: "c2",
      channelSlug: "chan-two",
      action: "ban",
      targetUserId: "u2",
      targetUsername: "bob",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      createdAt: now - 40 * day,
    });

    svc.setRetentionSetting("global", 60);
    svc.setRetentionSetting("channel:c1", 10);

    const deleted = svc.sweepModLogRetention(now);
    expect(deleted).toBe(1);
    expect(svc.queryModLog({ channelId: "c1" })).toHaveLength(0);
    expect(svc.queryModLog({ channelId: "c2" })).toHaveLength(1);
  });

  it("sweepModLogRetention with retention_days = NULL (forever) deletes nothing", () => {
    const svc = new DatabaseService();
    svc.initialize();
    const now = 2_000_000_000_000;
    svc.insertModLog({
      channelId: "c1",
      channelSlug: "chan-one",
      action: "ban",
      targetUserId: "u1",
      targetUsername: "alice",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      createdAt: now - 9999 * 86_400_000,
    });
    svc.setRetentionSetting("global", null);
    expect(svc.sweepModLogRetention(now)).toBe(0);
    expect(svc.queryModLog({ channelId: "c1" })).toHaveLength(1);
  });
});

describeDb("DatabaseService kick_automod_config helpers", () => {
  it("round-trips all 7 list columns via upsertKickAutomodConfig + getKickAutomodConfig", () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.upsertKickAutomodConfig({
      channelId: "kick-99",
      keywordBlocklist: ["badword1", "badword2"],
      severityIdentity: ["slur-a"],
      severitySexual: ["nsfw-1", "nsfw-2"],
      severityAggression: ["aggro"],
      severityBullying: ["bully"],
      allowlistUserIds: ["u-allow-1", "u-allow-2", "u-allow-3"],
      updatedAt: 1_700_000_000_000,
    });

    const got = svc.getKickAutomodConfig("kick-99");
    expect(got).toEqual({
      channelId: "kick-99",
      keywordBlocklist: ["badword1", "badword2"],
      severityIdentity: ["slur-a"],
      severitySexual: ["nsfw-1", "nsfw-2"],
      severityAggression: ["aggro"],
      severityBullying: ["bully"],
      allowlistUserIds: ["u-allow-1", "u-allow-2", "u-allow-3"],
      updatedAt: 1_700_000_000_000,
    });
  });

  it("a second upsertKickAutomodConfig fully overwrites the previous lists for the same channel", () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.upsertKickAutomodConfig({
      channelId: "kick-42",
      keywordBlocklist: ["old"],
      severityIdentity: ["old"],
      severitySexual: ["old"],
      severityAggression: ["old"],
      severityBullying: ["old"],
      allowlistUserIds: ["old"],
      updatedAt: 1,
    });
    svc.upsertKickAutomodConfig({
      channelId: "kick-42",
      keywordBlocklist: ["new1", "new2"],
      severityIdentity: [],
      severitySexual: [],
      severityAggression: [],
      severityBullying: [],
      allowlistUserIds: ["new-u"],
      updatedAt: 2,
    });

    const got = svc.getKickAutomodConfig("kick-42");
    expect(got).toEqual({
      channelId: "kick-42",
      keywordBlocklist: ["new1", "new2"],
      severityIdentity: [],
      severitySexual: [],
      severityAggression: [],
      severityBullying: [],
      allowlistUserIds: ["new-u"],
      updatedAt: 2,
    });
  });

  it("getKickAutomodConfig returns null for an unknown channel", () => {
    const svc = new DatabaseService();
    svc.initialize();
    expect(svc.getKickAutomodConfig("nope")).toBeNull();
  });
});

describeDb("DatabaseService retention_settings helpers", () => {
  it("getRetentionSetting returns undefined when no row exists, and round-trips both number and null", () => {
    const svc = new DatabaseService();
    svc.initialize();

    expect(svc.getRetentionSetting("global")).toBeUndefined();

    svc.setRetentionSetting("global", 14);
    expect(svc.getRetentionSetting("global")).toBe(14);

    // Upsert overwrites.
    svc.setRetentionSetting("global", null);
    expect(svc.getRetentionSetting("global")).toBeNull();

    svc.setRetentionSetting("channel:abc", 7);
    expect(svc.getRetentionSetting("channel:abc")).toBe(7);
  });
});
