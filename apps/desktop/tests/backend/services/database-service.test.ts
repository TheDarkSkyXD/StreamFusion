import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vitest.config.ts aliases `better-sqlite3` to a `node:sqlite`-backed shim
// (tests/helpers/better-sqlite3-shim.ts), so this suite no longer depends
// on the native Electron-targeted binary. The previous SQLITE_AVAILABLE
// skip pattern is therefore unnecessary.

// Guards: DatabaseService schema + migrations against the node:sqlite-shim — initialization, the local-follows schema, and any ON CONFLICT / named-param SQL paths must round-trip on the shim exactly as they do against native better-sqlite3 (parity covered by `tests/helpers/better-sqlite3-shim.test.ts`).

const describeDb = describe;

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "streamfusion-dbtest-"));
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
  it("creates mod_log and retention_settings on first initialize() and is idempotent on a second call", () => {
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
        "retention_settings",
        "pending_follow_writes",
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
      expect.arrayContaining(["mod_log", "retention_settings", "pending_follow_writes"])
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

describeDb("DatabaseService follow-row safety", () => {
  it("addFollow with empty channelId falls back to slug — two slug-only follows do NOT collide on UNIQUE(platform, channel_id, source)", () => {
    // Regression guard for the kick-DOM-scrape collision: before the fix
    // two slug-only follows both wrote channel_id="" and the second silently
    // replaced the first via INSERT OR REPLACE (only one row survived).
    const svc = new DatabaseService();
    svc.initialize();

    svc.addFollow(
      {
        platform: "kick",
        channelId: "",
        channelName: "summit1g",
        displayName: "Summit1G",
        profileImage: "",
      },
      "account"
    );
    svc.addFollow(
      {
        platform: "kick",
        channelId: "",
        channelName: "chickenandy",
        displayName: "ChickenAndy",
        profileImage: "",
      },
      "account"
    );

    const rows = svc.getFollowsByPlatformAndSource("kick", "account");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channelId).sort()).toEqual(["chickenandy", "summit1g"]);
  });

  it("replaceAccountFollows atomically swaps the account-source rows for a platform", () => {
    const svc = new DatabaseService();
    svc.initialize();

    // Seed prior account-source rows and a guest-source row that must survive.
    svc.addFollow(
      {
        platform: "kick",
        channelId: "stale1",
        channelName: "stale-one",
        displayName: "Stale One",
        profileImage: "",
      },
      "account"
    );
    svc.addFollow(
      {
        platform: "kick",
        channelId: "guest1",
        channelName: "guest-channel",
        displayName: "Guest Channel",
        profileImage: "",
      },
      "guest"
    );

    svc.replaceAccountFollows("kick", [
      {
        platform: "kick",
        channelId: "411439",
        channelName: "summit1g",
        displayName: "Summit1G",
        profileImage: "",
      },
      {
        platform: "kick",
        channelId: "550022",
        channelName: "chickenandy",
        displayName: "ChickenAndy",
        profileImage: "",
      },
    ]);

    const accountRows = svc.getFollowsByPlatformAndSource("kick", "account");
    expect(accountRows.map((r) => r.channelId).sort()).toEqual(["411439", "550022"]);
    // Guest row is untouched.
    const guestRows = svc.getFollowsByPlatformAndSource("kick", "guest");
    expect(guestRows.map((r) => r.channelId)).toEqual(["guest1"]);
  });

  it("replaceAccountFollows with an empty batch clears prior account-source rows but leaves guest rows intact", () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.addFollow(
      {
        platform: "kick",
        channelId: "prior1",
        channelName: "prior-channel",
        displayName: "Prior",
        profileImage: "",
      },
      "account"
    );
    svc.addFollow(
      {
        platform: "kick",
        channelId: "g1",
        channelName: "g",
        displayName: "G",
        profileImage: "",
      },
      "guest"
    );

    svc.replaceAccountFollows("kick", []);

    expect(svc.getFollowsByPlatformAndSource("kick", "account")).toHaveLength(0);
    expect(svc.getFollowsByPlatformAndSource("kick", "guest")).toHaveLength(1);
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

describeDb("DatabaseService pending_follow_writes helpers", () => {
  it("addPendingFollowWrite stores a row with all fields populated", () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.addPendingFollowWrite({
      platform: "twitch",
      channelId: "12345",
      slug: "somechannel",
      action: "follow",
      lastError: "integrity check failed",
    });

    const rows = svc.getAllPendingFollowWrites();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      platform: "twitch",
      channelId: "12345",
      slug: "somechannel",
      action: "follow",
      lastError: "integrity check failed",
    });
    expect(rows[0].id).toBeGreaterThan(0);
    expect(rows[0].attemptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601 prefix
  });

  it("addPendingFollowWrite UPSERTs on duplicate (platform, channel_id, action) — updates attempted_at and last_error, no duplicate row", async () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.addPendingFollowWrite({
      platform: "kick",
      channelId: "999",
      slug: "ramees",
      action: "follow",
      lastError: "first attempt",
    });
    const firstRow = svc.getAllPendingFollowWrites()[0];

    // Ensure the timestamp would actually advance.
    await new Promise((r) => setTimeout(r, 20));

    svc.addPendingFollowWrite({
      platform: "kick",
      channelId: "999",
      slug: "ramees",
      action: "follow",
      lastError: "second attempt",
    });

    const rows = svc.getAllPendingFollowWrites();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(firstRow.id);
    expect(rows[0].lastError).toBe("second attempt");
    expect(rows[0].attemptedAt > firstRow.attemptedAt).toBe(true);
  });

  it("a follow-pending and an unfollow-pending for the same channel coexist as distinct rows", () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.addPendingFollowWrite({
      platform: "kick",
      channelId: "999",
      slug: "ramees",
      action: "follow",
    });
    svc.addPendingFollowWrite({
      platform: "kick",
      channelId: "999",
      slug: "ramees",
      action: "unfollow",
    });

    const rows = svc.getAllPendingFollowWrites();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.action).sort()).toEqual(["follow", "unfollow"]);
  });

  it("removePendingFollowWrite deletes by composite key including action; sibling action stays", () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.addPendingFollowWrite({
      platform: "twitch",
      channelId: "12345",
      slug: "alice",
      action: "follow",
    });
    svc.addPendingFollowWrite({
      platform: "twitch",
      channelId: "12345",
      slug: "alice",
      action: "unfollow",
    });

    const removed = svc.removePendingFollowWrite({
      platform: "twitch",
      channelId: "12345",
      slug: "alice",
      action: "follow",
    });
    expect(removed).toBe(true);

    const remaining = svc.getAllPendingFollowWrites();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].action).toBe("unfollow");
  });

  it("removePendingFollowWrite matches by slug when channelId differs (dual-id bridge for legacy user_id rows)", () => {
    // Regression: docs/solutions/logic-errors/kick-guest-follows-dual-id-bridge-2026-05-15.md
    const svc = new DatabaseService();
    svc.initialize();

    // Pending row inserted with the numeric user_id Kick returned at sync time.
    svc.addPendingFollowWrite({
      platform: "kick",
      channelId: "12345",
      slug: "ramees",
      action: "follow",
    });

    // Retry path hydrates from a different source and passes slug as channelId.
    // The cleanup must still find the row via the slug bridge.
    const removed = svc.removePendingFollowWrite({
      platform: "kick",
      channelId: "ramees",
      slug: "ramees",
      action: "follow",
    });
    expect(removed).toBe(true);
    expect(svc.getAllPendingFollowWrites()).toHaveLength(0);
  });

  it("getPendingFollowWritesByPlatform returns only rows for the requested platform, ordered by attempted_at ascending", async () => {
    const svc = new DatabaseService();
    svc.initialize();

    svc.addPendingFollowWrite({
      platform: "twitch",
      channelId: "100",
      slug: "twitchA",
      action: "follow",
    });
    await new Promise((r) => setTimeout(r, 20));
    svc.addPendingFollowWrite({
      platform: "kick",
      channelId: "200",
      slug: "kickA",
      action: "follow",
    });
    await new Promise((r) => setTimeout(r, 20));
    svc.addPendingFollowWrite({
      platform: "twitch",
      channelId: "101",
      slug: "twitchB",
      action: "unfollow",
    });

    const twitchRows = svc.getPendingFollowWritesByPlatform("twitch");
    expect(twitchRows.map((r) => r.slug)).toEqual(["twitchA", "twitchB"]);

    const kickRows = svc.getPendingFollowWritesByPlatform("kick");
    expect(kickRows.map((r) => r.slug)).toEqual(["kickA"]);
  });

  it("CHECK constraint rejects an action value outside the enum", () => {
    const svc = new DatabaseService();
    svc.initialize();

    expect(() =>
      svc.addPendingFollowWrite({
        platform: "twitch",
        channelId: "1",
        slug: "foo",
        // @ts-expect-error — deliberately violating the type to exercise the CHECK constraint
        action: "subscribe",
      })
    ).toThrow();
  });

  it("removePendingFollowWrite returns false when no matching row exists", () => {
    const svc = new DatabaseService();
    svc.initialize();

    const removed = svc.removePendingFollowWrite({
      platform: "twitch",
      channelId: "nope",
      slug: "nope",
      action: "follow",
    });
    expect(removed).toBe(false);
  });

  it("pending_follow_writes table is created on a fresh DB, and survives reopen", () => {
    const svc = new DatabaseService();
    svc.initialize();
    svc.addPendingFollowWrite({
      platform: "twitch",
      channelId: "1",
      slug: "a",
      action: "follow",
    });

    // Re-instantiate against the same path — simulates an app restart.
    const svc2 = new DatabaseService();
    svc2.initialize();
    const rows = svc2.getAllPendingFollowWrites();
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("a");
  });
});
