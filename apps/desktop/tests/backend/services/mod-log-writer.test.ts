/**
 * mod-log-writer.test.ts
 *
 * After U12 was rewired through the IPC bridge (modlog-handlers), this suite
 * exercises the renderer-side behaviour of the writer:
 *
 *   - dedup buffer (renderer-only)
 *   - EventSub `channel.moderate` translation
 *   - bootstrap idempotency via Helix
 *   - initialize() retention sweep wiring
 *
 * The actual SQL lives in the main process and is mocked here. We capture the
 * IPC calls and assert on them; an in-memory mod-log store lets us simulate
 * the queryModLog ↔ insertModLog flow that bootstrapFromHelix relies on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetModLogWriterForTesting,
  modLogWriter,
  type ModLogAction,
} from "@/backend/services/mod-log-writer";
import type {
  ChannelModerateEvent,
  NotificationPayload,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";
import type { ModLogEntry, ModLogQueryFilters } from "@/shared/mod-log-types";

// ---------------------------------------------------------------------------
// Mock IPC bridge — in-memory store backs query/insert/sweep
// ---------------------------------------------------------------------------

interface BridgeMocks {
  store: ModLogEntry[];
  nextId: number;
  insert: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  sweepRetention: ReturnType<typeof vi.fn>;
}

let bridge: BridgeMocks;

function installBridge(): void {
  const store: ModLogEntry[] = [];
  let nextId = 1;

  const insert = vi.fn(async (entry: Omit<ModLogEntry, "id">) => {
    const id = nextId++;
    store.push({ ...entry, id });
    return id;
  });

  const query = vi.fn(async (filters: ModLogQueryFilters) => {
    return store
      .filter((row) => {
        if (row.channelId !== filters.channelId) return false;
        if (filters.targetUserId && row.targetUserId !== filters.targetUserId) return false;
        if (filters.action && row.action !== filters.action) return false;
        if (
          filters.moderatorUsername &&
          row.moderatorUsername !== filters.moderatorUsername
        )
          return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 100));
  });

  const sweepRetention = vi.fn(async (_now?: number) => 0);

  bridge = { store, nextId, insert, query, sweepRetention };

  (globalThis as unknown as { window: Window }).window =
    (globalThis as unknown as { window?: Window }).window ?? ({} as Window);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    modLog: {
      insert: bridge.insert,
      query: bridge.query,
      sweepRetention: bridge.sweepRetention,
    },
  };
}

beforeEach(() => {
  installBridge();
  __resetModLogWriterForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

function eventSubBan(
  overrides: Partial<ChannelModerateEvent> = {},
): NotificationPayload<ChannelModerateEvent> {
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

describe("ModLogWriter.initialize", () => {
  it("is idempotent — second call does not re-run the retention sweep", async () => {
    await modLogWriter.initialize();
    await modLogWriter.initialize();
    await modLogWriter.initialize();
    expect(bridge.sweepRetention).toHaveBeenCalledTimes(1);
  });
});

describe("ModLogWriter.record", () => {
  it("forwards the insert to the IPC bridge and returns the rowid", async () => {
    const id = await modLogWriter.record(baseRecord());
    expect(id).toBeTypeOf("number");
    expect(id).toBeGreaterThan(0);
    expect(bridge.insert).toHaveBeenCalledTimes(1);
    expect(bridge.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "c1",
        action: "ban",
        targetUserId: "u-bad",
      }),
    );
  });

  it("dedups when same key arrives from a different source within ±2s", async () => {
    const t = 1_700_000_000_000;
    const firstId = await modLogWriter.record(
      baseRecord({ source: "local", occurredAt: t }),
    );
    expect(firstId).not.toBeNull();

    const secondId = await modLogWriter.record(
      baseRecord({ source: "eventsub", occurredAt: t + 1_500 }),
    );
    expect(secondId).toBeNull();
    expect(bridge.insert).toHaveBeenCalledTimes(1);
  });

  it("does NOT dedup when the two records share the same source", async () => {
    const t = 1_700_000_000_000;
    const a = await modLogWriter.record(baseRecord({ source: "local", occurredAt: t }));
    const b = await modLogWriter.record(
      baseRecord({ source: "local", occurredAt: t + 500 }),
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(bridge.insert).toHaveBeenCalledTimes(2);
  });

  it("does NOT dedup when the records are >2s apart", async () => {
    const t = 1_700_000_000_000;
    const a = await modLogWriter.record(baseRecord({ source: "local", occurredAt: t }));
    const b = await modLogWriter.record(
      baseRecord({ source: "eventsub", occurredAt: t + 5_000 }),
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(bridge.insert).toHaveBeenCalledTimes(2);
  });

  it("does NOT dedup across different actions on the same target", async () => {
    const t = 1_700_000_000_000;
    await modLogWriter.record(baseRecord({ action: "ban", source: "local", occurredAt: t }));
    await modLogWriter.record(
      baseRecord({ action: "timeout", source: "eventsub", occurredAt: t + 100 }),
    );
    expect(bridge.insert).toHaveBeenCalledTimes(2);
  });
});

describe("ModLogWriter.ingestEventSubModerate", () => {
  it("inserts a ban with the correct target + moderator ids", async () => {
    await modLogWriter.ingestEventSubModerate(eventSubBan());
    expect(bridge.insert).toHaveBeenCalledTimes(1);
    expect(bridge.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ban",
        targetUserId: "u-bad",
        targetUsername: "bad-user",
        moderatorUserId: "m1",
        moderatorUsername: "modA",
        reason: "spam",
        durationSeconds: null,
      }),
    );
  });

  it("derives durationSeconds for a timeout sub-action from expires_at - now", async () => {
    const createdAt = 1_700_000_000_000;
    const expiresAt = createdAt + 600_000; // +10 minutes
    await modLogWriter.ingestEventSubModerate({
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
    expect(bridge.insert).toHaveBeenCalledTimes(1);
    expect(bridge.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "timeout", durationSeconds: 600 }),
    );
  });

  it("warns and skips an unknown sub-action key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await modLogWriter.ingestEventSubModerate({
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
    expect(bridge.insert).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("ModLogWriter.bootstrapFromHelix", () => {
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
      }),
    );

    const inserted = await modLogWriter.bootstrapFromHelix({
      channelId: "c1",
      channelSlug: "chan-one",
      accessToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(inserted).toBe(3);
    expect(bridge.store).toHaveLength(3);
    const bob = bridge.store.find((r) => r.targetUsername === "bob");
    expect(bob?.action).toBe("timeout");
    expect(bob?.durationSeconds).toBeGreaterThan(0);
    const alice = bridge.store.find((r) => r.targetUsername === "alice");
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
    const fetchImpl = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
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
      }),
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
    expect(bridge.store).toHaveLength(1);
  });
});
