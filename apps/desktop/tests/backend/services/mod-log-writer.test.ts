import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same skip guard the U2 suite uses: better-sqlite3 binary may target Electron
// instead of system Node. See database-service.test.ts for the full rationale.
const SQLITE_AVAILABLE = (() => {
  try {
    new Database(":memory:").close();
    return true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: surfacing skip reason
    console.warn(
      "[mod-log-writer.test] better-sqlite3 native binary mismatch — skipping. " +
        "Run `npm rebuild better-sqlite3` to run these tests."
    );
    return false;
  }
})();

let currentTmpDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: (_kind: string) => currentTmpDir,
  },
}));

// Imports after the electron mock is in place.
import { dbService } from "@/backend/services/database-service";
import {
  __resetModLogWriterForTesting,
  modLogWriter,
  type ModLogAction,
} from "@/backend/services/mod-log-writer";
import type {
  ChannelModerateEvent,
  NotificationPayload,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "streamforge-modlogwriter-"));
}

function resetSingletonDb(): void {
  // Tear down the dbService singleton's open handle so each test gets a fresh
  // SQLite file at the per-test tmp dir.
  // biome-ignore lint/suspicious/noExplicitAny: test-only escape hatch
  const s = dbService as any;
  if (s.db) {
    try {
      s.db.close();
    } catch {
      // ignore
    }
    s.db = null;
  }
}

beforeEach(() => {
  currentTmpDir = makeTmpDir();
  resetSingletonDb();
  __resetModLogWriterForTesting();
  dbService.initialize();
});

afterEach(() => {
  resetSingletonDb();
  try {
    fs.rmSync(currentTmpDir, { recursive: true, force: true });
  } catch {
    // ignore — Windows may hold a file briefly
  }
});

const describeModLog = SQLITE_AVAILABLE ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseRecord(overrides: Partial<Parameters<typeof modLogWriter.record>[0]> = {}) {
  return {
    channelId: "c1",
    channelSlug: "chan-one",
    action: "ban" as ModLogAction,
    targetUserId: "u-bad",
    targetUsername: "bad-user",
    moderatorUserId: "m1",
    moderatorUsername: "modA",
    source: "local" as const,
    ...overrides,
  };
}

function eventSubBan(overrides: Partial<ChannelModerateEvent> = {}): NotificationPayload<ChannelModerateEvent> {
  return {
    subscription: {
      id: "sub-1",
      type: "channel.moderate",
      version: "2",
      status: "enabled",
      cost: 0,
      condition: {},
      transport: { method: "websocket", session_id: "sess-1" },
      created_at: new Date(1_700_000_000_000).toISOString(),
    },
    event: {
      broadcaster_user_id: "c1",
      broadcaster_user_login: "chan-one",
      broadcaster_user_name: "ChanOne",
      moderator_user_id: "m1",
      moderator_user_login: "modA",
      moderator_user_name: "ModA",
      action: "ban",
      ban: {
        user_id: "u-bad",
        user_login: "bad-user",
        user_name: "BadUser",
        reason: "spam",
      },
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeModLog("ModLogWriter.initialize", () => {
  it("is idempotent — second call does not re-run the retention sweep", () => {
    const spy = vi.spyOn(dbService, "sweepModLogRetention");
    modLogWriter.initialize();
    modLogWriter.initialize();
    modLogWriter.initialize();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describeModLog("ModLogWriter.record", () => {
  it("inserts and returns the rowid", () => {
    const id = modLogWriter.record(baseRecord());
    expect(id).toBeTypeOf("number");
    expect(id).toBeGreaterThan(0);

    const rows = dbService.queryModLog({ channelId: "c1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].targetUserId).toBe("u-bad");
    expect(rows[0].action).toBe("ban");
  });

  it("dedups when same key arrives from a different source within ±2s", () => {
    const t = 1_700_000_000_000;
    const firstId = modLogWriter.record(baseRecord({ source: "local", occurredAt: t }));
    expect(firstId).not.toBeNull();

    // Same (channelId, action, targetUserId) but different source within window.
    const secondId = modLogWriter.record(
      baseRecord({ source: "eventsub", occurredAt: t + 1_500 })
    );
    expect(secondId).toBeNull();

    const rows = dbService.queryModLog({ channelId: "c1" });
    expect(rows).toHaveLength(1);
  });

  it("does NOT dedup when the two records share the same source", () => {
    const t = 1_700_000_000_000;
    const a = modLogWriter.record(baseRecord({ source: "local", occurredAt: t }));
    const b = modLogWriter.record(baseRecord({ source: "local", occurredAt: t + 500 }));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(dbService.queryModLog({ channelId: "c1" })).toHaveLength(2);
  });

  it("does NOT dedup when the records are >2s apart", () => {
    const t = 1_700_000_000_000;
    const a = modLogWriter.record(baseRecord({ source: "local", occurredAt: t }));
    const b = modLogWriter.record(
      baseRecord({ source: "eventsub", occurredAt: t + 5_000 })
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(dbService.queryModLog({ channelId: "c1" })).toHaveLength(2);
  });

  it("does NOT dedup across different actions on the same target", () => {
    const t = 1_700_000_000_000;
    modLogWriter.record(baseRecord({ action: "ban", source: "local", occurredAt: t }));
    modLogWriter.record(
      baseRecord({ action: "timeout", source: "eventsub", occurredAt: t + 100 })
    );
    expect(dbService.queryModLog({ channelId: "c1" })).toHaveLength(2);
  });
});

describeModLog("ModLogWriter.ingestEventSubModerate", () => {
  it("inserts a ban with the correct target + moderator ids", () => {
    modLogWriter.ingestEventSubModerate(eventSubBan());
    const rows = dbService.queryModLog({ channelId: "c1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "ban",
      targetUserId: "u-bad",
      targetUsername: "bad-user",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      reason: "spam",
      durationSeconds: null,
    });
  });

  it("derives durationSeconds for a timeout sub-action from expires_at - now", () => {
    const createdAt = 1_700_000_000_000;
    const expiresAt = createdAt + 600_000; // +10 minutes
    modLogWriter.ingestEventSubModerate({
      subscription: {
        id: "sub-2",
        type: "channel.moderate",
        version: "2",
        status: "enabled",
        cost: 0,
        condition: {},
        transport: { method: "websocket", session_id: "sess-1" },
        created_at: new Date(createdAt).toISOString(),
      },
      event: {
        broadcaster_user_id: "c1",
        broadcaster_user_login: "chan-one",
        broadcaster_user_name: "ChanOne",
        moderator_user_id: "m1",
        moderator_user_login: "modA",
        moderator_user_name: "ModA",
        action: "timeout",
        timeout: {
          user_id: "u-bad",
          user_login: "bad-user",
          user_name: "BadUser",
          reason: "cooldown",
          expires_at: new Date(expiresAt).toISOString(),
        },
      },
    });
    const rows = dbService.queryModLog({ channelId: "c1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("timeout");
    expect(rows[0].durationSeconds).toBe(600);
  });

  it("warns and skips an unknown sub-action key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    modLogWriter.ingestEventSubModerate({
      subscription: {
        id: "sub-3",
        type: "channel.moderate",
        version: "2",
        status: "enabled",
        cost: 0,
        condition: {},
        transport: { method: "websocket", session_id: "sess-1" },
        created_at: new Date(1_700_000_000_000).toISOString(),
      },
      event: {
        broadcaster_user_id: "c1",
        broadcaster_user_login: "chan-one",
        broadcaster_user_name: "ChanOne",
        moderator_user_id: "m1",
        moderator_user_login: "modA",
        moderator_user_name: "ModA",
        action: "frobnicate-the-widget",
      },
    });
    expect(warn).toHaveBeenCalled();
    expect(dbService.queryModLog({ channelId: "c1" })).toHaveLength(0);
    warn.mockRestore();
  });
});

describeModLog("ModLogWriter.bootstrapFromHelix", () => {
  function helixResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("inserts one entry per banned user (happy path, single page)", async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      helixResponse({
        data: [
          {
            user_id: "u1",
            user_login: "alice",
            user_name: "Alice",
            expires_at: null,
            created_at: new Date(1_700_000_000_000).toISOString(),
            reason: "spam",
            moderator_id: "m1",
            moderator_login: "modA",
            moderator_name: "ModA",
          },
          {
            user_id: "u2",
            user_login: "bob",
            user_name: "Bob",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            created_at: new Date(1_700_000_000_000).toISOString(),
            reason: null,
            moderator_id: "m1",
            moderator_login: "modA",
            moderator_name: "ModA",
          },
          {
            user_id: "u3",
            user_login: "carol",
            user_name: "Carol",
            expires_at: null,
            created_at: new Date(1_700_000_001_000).toISOString(),
            reason: null,
            moderator_id: "m1",
            moderator_login: "modA",
            moderator_name: "ModA",
          },
        ],
        pagination: {},
      })
    );

    const inserted = await modLogWriter.bootstrapFromHelix({
      channelId: "c1",
      channelSlug: "chan-one",
      accessToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(inserted).toBe(3);

    const rows = dbService.queryModLog({ channelId: "c1" });
    expect(rows).toHaveLength(3);
    // Bob has expires_at — should be a timeout.
    const bob = rows.find((r) => r.targetUsername === "bob");
    expect(bob?.action).toBe("timeout");
    expect(bob?.durationSeconds).toBeGreaterThan(0);
    const alice = rows.find((r) => r.targetUsername === "alice");
    expect(alice?.action).toBe("ban");
  });

  it("walks pages while a cursor is present", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const after = parsed.searchParams.get("after");
      if (!after) {
        return helixResponse({
          data: [
            {
              user_id: "u1",
              user_login: "alice",
              user_name: "Alice",
              expires_at: null,
              created_at: new Date(1_700_000_000_000).toISOString(),
              reason: null,
              moderator_id: "m1",
              moderator_login: "modA",
              moderator_name: "ModA",
            },
          ],
          pagination: { cursor: "page2" },
        });
      }
      return helixResponse({
        data: [
          {
            user_id: "u2",
            user_login: "bob",
            user_name: "Bob",
            expires_at: null,
            created_at: new Date(1_700_000_001_000).toISOString(),
            reason: null,
            moderator_id: "m1",
            moderator_login: "modA",
            moderator_name: "ModA",
          },
        ],
        pagination: {},
      });
    });

    const inserted = await modLogWriter.bootstrapFromHelix({
      channelId: "c1",
      channelSlug: "chan-one",
      accessToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(inserted).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns 0 and warns on 401 (no throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () =>
      new Response("unauthorized", { status: 401 })
    );

    const inserted = await modLogWriter.bootstrapFromHelix({
      channelId: "c1",
      channelSlug: "chan-one",
      accessToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(inserted).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is idempotent — calling twice does not double-insert", async () => {
    const fetchImpl = vi.fn(async () =>
      helixResponse({
        data: [
          {
            user_id: "u1",
            user_login: "alice",
            user_name: "Alice",
            expires_at: null,
            created_at: new Date(1_700_000_000_000).toISOString(),
            reason: null,
            moderator_id: "m1",
            moderator_login: "modA",
            moderator_name: "ModA",
          },
        ],
        pagination: {},
      })
    );

    const firstInsert = await modLogWriter.bootstrapFromHelix({
      channelId: "c1",
      channelSlug: "chan-one",
      accessToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(firstInsert).toBe(1);

    const secondInsert = await modLogWriter.bootstrapFromHelix({
      channelId: "c1",
      channelSlug: "chan-one",
      accessToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(secondInsert).toBe(0);

    expect(dbService.queryModLog({ channelId: "c1" })).toHaveLength(1);
  });
});

describeModLog("AE10: ModLogWriter.initialize triggers retention sweep", () => {
  it("deletes rows older than the global retention window on initialize()", () => {
    const day = 86_400_000;
    const now = Date.now();

    // Pre-seed: one old row (60d ago) + one fresh row (1d ago).
    dbService.insertModLog({
      channelId: "c1",
      channelSlug: "chan-one",
      action: "ban",
      targetUserId: "u-old",
      targetUsername: "old-user",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      createdAt: now - 60 * day,
    });
    dbService.insertModLog({
      channelId: "c1",
      channelSlug: "chan-one",
      action: "ban",
      targetUserId: "u-fresh",
      targetUsername: "fresh-user",
      moderatorUserId: "m1",
      moderatorUsername: "modA",
      createdAt: now - 1 * day,
    });
    dbService.setRetentionSetting("global", 30);

    modLogWriter.initialize();

    const rows = dbService.queryModLog({ channelId: "c1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].targetUserId).toBe("u-fresh");
  });
});
