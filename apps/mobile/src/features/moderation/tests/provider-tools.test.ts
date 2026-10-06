import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedPlatformAccess,
  PlatformAccess,
} from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ProviderCredential,
  ProviderResult,
} from "../capabilities/moderation";
import type {
  ChannelToolsGateway,
  FeedState,
  ModerationFeedGateway,
  ToolCommandResult,
  ToolSnapshot,
} from "../capabilities/provider-tools";
import { createChannelToolsApi } from "../adapters/channel-tools-api";
import { createProviderToolsController } from "../domain/provider-tools-controller";
import { createModerationLogRepository } from "../data/moderation-log";
import { createModerationController } from "../domain/moderation-controller";
import { createModerationApi } from "../adapters/moderation-api";

const actor: ProviderCredential = {
  kind: "ready",
  platform: "twitch",
  accessToken: "token",
  clientId: "client",
  userId: "10",
  username: "owner",
  generation: 1,
  scopes: [],
};
const channel: ModerationChannel = {
  platform: "twitch",
  id: "10",
  login: "owner",
  name: "Owner",
};
const signal = new AbortController().signal;
const allow = async () => true;
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let account: PlatformAccess = actor;
  const listeners = new Set<() => void>();
  const access: AuthenticatedPlatformAccess = {
    read: vi.fn(async () => account),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const gateway: ChannelToolsGateway = {
    searchCategories: vi.fn(),
    read: vi.fn(async () => ({
      kind: "success",
      value: { kind: "shield", active: false, activatedAt: "" },
    })),
    execute: vi.fn(async (_channel, _actor, _command, _signal, beforeSubmit) =>
      (await beforeSubmit())
        ? { kind: "success", value: { kind: "confirmed" } }
        : { kind: "failure", reason: "auth", detail: "Account changed" },
    ),
  };
  let receive: (state: FeedState) => void = () => undefined;
  let feedSignal: AbortSignal | null = null;
  const feeds: ModerationFeedGateway = {
    subscribe: vi.fn(async (_channel, _actor, _feed, callback, signal) => {
      receive = callback;
      feedSignal = signal;
    }),
  };
  const authorization = {
    verify: vi.fn(
      async (): Promise<ProviderResult<"broadcaster" | "moderator">> => ({
        kind: "success",
        value: "broadcaster",
      }),
    ),
  };
  const controller = createProviderToolsController({
    access,
    gateway,
    feeds,
    authorization,
  });
  controller.bindChannel(channel, 1);
  return {
    controller,
    access,
    gateway,
    feeds,
    authorization,
    emit: (state: FeedState) => receive(state),
    feedSignal: () => feedSignal,
    change(next: PlatformAccess, notify = true) {
      account = next;
      if (notify) for (const listener of listeners) listener();
    },
  };
}
describe("mobile channel tools provider boundaries", () => {
  it("uses real Twitch category search results", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          data: [{ id: "509658", name: "Just Chatting" }],
          pagination: { cursor: "next" },
        }),
      );
    expect(
      await createChannelToolsApi(fetch).searchCategories(
        actor,
        "Just Chatting",
        signal,
      ),
    ).toEqual({
      kind: "success",
      value: {
        query: "Just Chatting",
        categories: [{ id: "509658", name: "Just Chatting" }],
        cursor: "next",
      },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.twitch.tv/helix/search/categories?query=Just%20Chatting&first=30",
    );
  });
  it("fulfills an eligible app-created reward only after a provider-confirmed redemption update", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "owned", title: "Reward", cost: 1000 }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "request",
              user_id: "20",
              user_login: "viewer",
              user_name: "Viewer",
              user_input: "Please",
              status: "FULFILLED",
              redeemed_at: "2026-10-05T12:00:00Z",
              reward: { id: "owned", title: "Reward" },
            },
          ],
        }),
      );
    expect(
      await createChannelToolsApi(fetch).execute(
        channel,
        actor,
        {
          kind: "reward-decision",
          rewardId: "owned",
          redemptionId: "request",
          status: "FULFILLED",
        },
        signal,
        allow,
      ),
    ).toEqual({ kind: "success", value: { kind: "confirmed" } });
    expect(fetch.mock.calls[1]).toEqual([
      "https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=10&reward_id=owned&id=request",
      expect.objectContaining({
        method: "PATCH",
        body: '{"status":"FULFILLED"}',
      }),
    ]);
  });
  it("clears suspicious treatment with the official DELETE operation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: [{ user_id: "20", status: "NO_TREATMENT" }] }),
      );
    expect(
      await createChannelToolsApi(fetch).execute(
        channel,
        actor,
        { kind: "suspicious-status", userId: "20", status: "NO_TREATMENT" },
        signal,
        allow,
      ),
    ).toEqual({ kind: "success", value: { kind: "confirmed" } });
    expect(fetch.mock.calls[0]).toEqual([
      "https://api.twitch.tv/helix/moderation/suspicious_users?broadcaster_id=10&moderator_id=10&user_id=20",
      expect.objectContaining({ method: "DELETE" }),
    ]);
  });
  it("reads and writes Twitch Shield Mode with the official PUT endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { is_active: true, last_activated_at: "2026-10-05T12:00:00Z" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { is_active: false, last_activated_at: "2026-10-05T12:00:00Z" },
          ],
        }),
      );
    const gateway = createChannelToolsApi(fetch);
    expect(await gateway.read(channel, actor, "shield", signal)).toEqual({
      kind: "success",
      value: {
        kind: "shield",
        active: true,
        activatedAt: "2026-10-05T12:00:00Z",
      },
    });
    expect(
      await gateway.execute(
        channel,
        actor,
        { kind: "shield", active: false },
        signal,
        allow,
      ),
    ).toEqual({ kind: "success", value: { kind: "confirmed" } });
    expect(fetch.mock.calls[1]).toEqual([
      "https://api.twitch.tv/helix/moderation/shield_mode?broadcaster_id=10&moderator_id=10",
      expect.objectContaining({ method: "PUT", body: '{"is_active":false}' }),
    ]);
  });
  it("parses stream information and sends actual content labels, language, category, and tags", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              broadcaster_id: "10",
              title: "Live",
              game_id: "123",
              game_name: "Game",
              broadcaster_language: "en",
              tags: ["English"],
              content_classification_labels: ["ProfanityVulgarity"],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { id: "ProfanityVulgarity", name: "Profanity" },
            { id: "Gambling", name: "Gambling" },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = createChannelToolsApi(fetch);
    const result = await gateway.read(channel, actor, "stream-info", signal);
    expect(result).toEqual({
      kind: "success",
      value: {
        kind: "stream-info",
        title: "Live",
        categoryId: "123",
        categoryName: "Game",
        language: "en",
        tags: ["English"],
        labels: ["ProfanityVulgarity"],
        availableLabels: [
          { id: "ProfanityVulgarity", name: "Profanity" },
          { id: "Gambling", name: "Gambling" },
        ],
      },
    });
    if (result.kind !== "success" || result.value.kind !== "stream-info")
      throw new Error("Missing parsed stream info");
    await gateway.execute(
      channel,
      actor,
      { kind: "stream-info", value: { ...result.value, title: "Updated" } },
      signal,
      allow,
    );
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({
        title: "Updated",
        game_id: "123",
        broadcaster_language: "en",
        tags: ["English"],
        content_classification_labels: [
          { id: "ProfanityVulgarity", is_enabled: true },
          { id: "Gambling", is_enabled: false },
        ],
      }),
    });
  });
  it("preserves per-category AutoMod levels and uses PUT for policy changes", async () => {
    const categories = {
      aggression: 1,
      bullying: 2,
      disability: 3,
      misogyny: 4,
      race_ethnicity_or_religion: 1,
      sex_based_terms: 2,
      sexuality_sex_or_gender: 3,
      swearing: 4,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ overall_level: null, ...categories }] }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ overall_level: null, ...categories }] }),
      );
    const gateway = createChannelToolsApi(fetch);
    expect(
      await gateway.read(channel, actor, "automod-policy", signal),
    ).toEqual({
      kind: "success",
      value: { kind: "automod-policy", overall: null, categories },
    });
    await gateway.execute(
      channel,
      actor,
      {
        kind: "automod-policy",
        value: { kind: "automod-policy", overall: null, categories },
      },
      signal,
      allow,
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify(categories),
    });
  });
  it("reads paginated blocked terms and encodes deletion identifiers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "term/1", text: "spam" }],
          pagination: { cursor: "next/1" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = createChannelToolsApi(fetch);
    expect(
      await gateway.read(channel, actor, "blocked-terms", signal, "page/1"),
    ).toEqual({
      kind: "success",
      value: {
        kind: "blocked-terms",
        terms: [{ id: "term/1", text: "spam" }],
        cursor: "next/1",
      },
    });
    await gateway.execute(
      channel,
      actor,
      { kind: "remove-term", id: "term/1" },
      signal,
      allow,
    );
    expect(fetch.mock.calls[0]?.[0]).toContain("after=page%2F1");
    expect(fetch.mock.calls[1]?.[0]).toContain("id=term%2F1");
  });
  it("rejects malformed reads and keeps provider denial distinct from an empty list", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ user_name: "missing ID" }], total: 1 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ data: [], total: 0 }));
    const gateway = createChannelToolsApi(fetch);
    expect(
      await gateway.read(channel, actor, "community", signal),
    ).toMatchObject({ kind: "failure", reason: "provider" });
    expect(
      await gateway.read(channel, actor, "community", signal),
    ).toMatchObject({ kind: "failure", reason: "permission" });
    expect(await gateway.read(channel, actor, "community", signal)).toEqual({
      kind: "success",
      value: { kind: "community", people: [], total: 0, cursor: null },
    });
  });
  it("revalidates a live raid target and confirms pending without a fabricated viewer count", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              user_id: "20",
              user_login: "target",
              user_name: "Target",
              title: "Live target",
              viewer_count: 37,
              type: "live",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ created_at: "2026-10-05T12:00:00Z", is_mature: false }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = createChannelToolsApi(fetch);
    expect(
      await gateway.execute(
        channel,
        actor,
        { kind: "raid", targetId: "20" },
        signal,
        allow,
      ),
    ).toEqual({
      kind: "success",
      value: {
        kind: "raid-pending",
        targetId: "20",
        createdAt: "2026-10-05T12:00:00Z",
        viewers: null,
      },
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://api.twitch.tv/helix/raids?from_broadcaster_id=10&to_broadcaster_id=20",
    );
    await gateway.execute(
      channel,
      actor,
      { kind: "cancel-raid" },
      signal,
      allow,
    );
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
  });
  it("does not submit raids for offline targets or after final authorization fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
    const gateway = createChannelToolsApi(fetch);
    expect(
      await gateway.execute(
        channel,
        actor,
        { kind: "raid", targetId: "20" },
        signal,
        allow,
      ),
    ).toMatchObject({ kind: "failure", reason: "invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await gateway.execute(
        channel,
        actor,
        { kind: "shield", active: true },
        signal,
        async () => false,
      ),
    ).toMatchObject({ kind: "failure", reason: "auth" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("denies reward decisions for rewards the app did not create", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "owned", title: "Owned", cost: 500 }] }),
      );
    const gateway = createChannelToolsApi(fetch);
    expect(
      await gateway.execute(
        channel,
        actor,
        {
          kind: "reward-decision",
          rewardId: "other",
          redemptionId: "request",
          status: "FULFILLED",
        },
        signal,
        allow,
      ),
    ).toMatchObject({ kind: "failure", reason: "permission" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain("only_manageable_rewards=true");
  });
  it("uses official suspicious-user and account whisper mutations", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ user_id: "20", status: "RESTRICTED" }] }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = createChannelToolsApi(fetch);
    await gateway.execute(
      channel,
      actor,
      { kind: "suspicious-status", userId: "20", status: "RESTRICTED" },
      signal,
      allow,
    );
    await gateway.execute(
      channel,
      actor,
      { kind: "whisper", userId: "30", text: "Hello" },
      signal,
      allow,
    );
    expect(fetch.mock.calls[0]).toEqual([
      "https://api.twitch.tv/helix/moderation/suspicious_users?broadcaster_id=10&moderator_id=10",
      expect.objectContaining({
        method: "POST",
        body: '{"user_id":"20","status":"RESTRICTED"}',
      }),
    ]);
    expect(fetch.mock.calls[1]).toEqual([
      "https://api.twitch.tv/helix/whispers?from_user_id=10&to_user_id=30",
      expect.objectContaining({ method: "POST", body: '{"message":"Hello"}' }),
    ]);
  });
  it("returns unsupported Kick tools without making undocumented requests", async () => {
    const fetch = vi.fn();
    const gateway = createChannelToolsApi(fetch);
    const kick = { ...channel, platform: "kick" } as const;
    expect(
      await gateway.read(
        kick,
        { ...actor, platform: "kick" },
        "shield",
        signal,
      ),
    ).toMatchObject({ kind: "failure", reason: "unsupported" });
    expect(
      await gateway.execute(
        kick,
        { ...actor, platform: "kick" },
        { kind: "raid", targetId: "20" },
        signal,
        allow,
      ),
    ).toMatchObject({ kind: "failure", reason: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("mobile provider tool authorization and leases", () => {
  it("rechecks account generation after a raid target read and before the POST", async () => {
    const pending = deferred<Response>();
    let currentActor = actor;
    const fetch = vi.fn().mockReturnValueOnce(pending.promise);
    const controller = createProviderToolsController({
      access: {
        read: async () => currentActor,
        subscribe: () => () => undefined,
      },
      authorization: {
        verify: async () => ({ kind: "success", value: "broadcaster" }),
      },
      gateway: createChannelToolsApi(fetch),
      feeds: { subscribe: async () => undefined },
    });
    controller.bindChannel(channel, 1);
    const write = controller.execute({ kind: "raid", targetId: "20" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    currentActor = { ...actor, generation: 2 };
    pending.resolve(
      Response.json({
        data: [
          {
            user_id: "20",
            user_login: "target",
            user_name: "Target",
            title: "Live",
            viewer_count: 10,
            type: "live",
          },
        ],
      }),
    );
    await write;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      channel: null,
      raid: { kind: "idle" },
    });
    controller.dispose();
  });
  it("uses read/manage scope alternatives and rechecks the selected role", async () => {
    const runtime = setup();
    runtime.change({ ...actor, scopes: ["moderator:manage:shield_mode"] });
    runtime.controller.bindChannel(channel, 2);
    await runtime.controller.read("shield");
    expect(runtime.access.read).toHaveBeenCalledWith("twitch", [
      "moderator:manage:shield_mode",
    ]);
    expect(runtime.authorization.verify).toHaveBeenCalledWith(
      channel,
      expect.objectContaining({ userId: "10" }),
      expect.any(AbortSignal),
    );
    runtime.controller.dispose();
  });
  it("rejects stale channel read results", async () => {
    const runtime = setup();
    const pending = deferred<ProviderResult<ToolSnapshot>>();
    vi.mocked(runtime.gateway.read).mockReturnValueOnce(pending.promise);
    const read = runtime.controller.read("shield");
    await vi.waitFor(() =>
      expect(runtime.gateway.read).toHaveBeenCalledTimes(1),
    );
    runtime.controller.bindChannel({ ...channel, id: "20" }, 2);
    pending.resolve({
      kind: "success",
      value: { kind: "shield", active: true, activatedAt: "today" },
    });
    await read;
    expect(runtime.controller.getSnapshot()).toMatchObject({
      channel: { id: "20" },
      data: null,
      activity: { kind: "idle" },
    });
    runtime.controller.dispose();
  });
  it("does not submit a write after an unannounced credential generation change", async () => {
    const runtime = setup();
    const role = deferred<ProviderResult<"broadcaster" | "moderator">>();
    runtime.authorization.verify.mockReturnValueOnce(role.promise);
    const write = runtime.controller.execute({ kind: "shield", active: true });
    await vi.waitFor(() =>
      expect(runtime.authorization.verify).toHaveBeenCalledTimes(1),
    );
    runtime.change({ ...actor, generation: 2 }, false);
    role.resolve({ kind: "success", value: "broadcaster" });
    await write;
    expect(runtime.gateway.execute).not.toHaveBeenCalled();
    expect(runtime.controller.getSnapshot().channel).toBeNull();
    runtime.controller.dispose();
  });
  it("does not submit broadcaster tools using a moderator's account", async () => {
    const runtime = setup();
    runtime.controller.bindChannel({ ...channel, id: "20" }, 2);
    await runtime.controller.execute({ kind: "raid", targetId: "30" });
    expect(runtime.gateway.execute).not.toHaveBeenCalled();
    expect(runtime.controller.getSnapshot().activity).toMatchObject({
      kind: "failure",
      detail: "This tool requires the selected channel's broadcaster account.",
    });
    runtime.controller.dispose();
  });
  it("reports a submitted raid as uncertain when waiting stops and never retries the write", async () => {
    const runtime = setup();
    const pending = deferred<ProviderResult<ToolCommandResult>>();
    vi.mocked(runtime.gateway.execute).mockImplementationOnce(
      async (_channel, _actor, _command, _signal, beforeSubmit) => {
        await beforeSubmit();
        return pending.promise;
      },
    );
    const first = runtime.controller.execute({ kind: "raid", targetId: "20" });
    await vi.waitFor(() =>
      expect(runtime.gateway.execute).toHaveBeenCalledTimes(1),
    );
    await runtime.controller.execute({ kind: "raid", targetId: "20" });
    runtime.controller.cancel();
    expect(runtime.controller.getSnapshot()).toMatchObject({
      activity: {
        kind: "cancelled",
        detail: expect.stringContaining("may have applied"),
      },
      raid: { kind: "uncertain" },
    });
    pending.resolve({
      kind: "success",
      value: {
        kind: "raid-pending",
        targetId: "20",
        createdAt: "today",
        viewers: null,
      },
    });
    await first;
    expect(runtime.gateway.execute).toHaveBeenCalledTimes(1);
    expect(runtime.controller.getSnapshot().raid.kind).toBe("uncertain");
    runtime.controller.dispose();
  });
  it("preserves pending raid until Twitch confirms cancellation", async () => {
    const runtime = setup();
    vi.mocked(runtime.gateway.execute).mockImplementationOnce(
      async (_channel, _actor, _command, _signal, beforeSubmit) => {
        await beforeSubmit();
        return {
          kind: "success",
          value: {
            kind: "raid-pending",
            targetId: "20",
            createdAt: "today",
            viewers: null,
          },
        };
      },
    );
    await runtime.controller.execute({ kind: "raid", targetId: "20" });
    expect(runtime.controller.getSnapshot().raid).toEqual({
      kind: "pending",
      targetId: "20",
      createdAt: "today",
    });
    await runtime.controller.execute({ kind: "cancel-raid" });
    expect(runtime.controller.getSnapshot().raid).toEqual({ kind: "idle" });
    runtime.controller.dispose();
  });
  it("drops feed callbacks after account change and closes the old lease", async () => {
    const runtime = setup();
    await runtime.controller.startFeed("automod");
    runtime.emit({ kind: "live", since: "today", items: [] });
    await vi.waitFor(() =>
      expect(runtime.controller.getSnapshot().feed.kind).toBe("live"),
    );
    runtime.change({ ...actor, generation: 2 });
    runtime.emit({ kind: "live", since: "old", items: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.feedSignal()?.aborted).toBe(true);
    expect(runtime.controller.getSnapshot()).toMatchObject({
      channel: null,
      feed: { kind: "idle" },
    });
    runtime.controller.dispose();
  });
  it("distinguishes an empty connected feed from background disconnection", async () => {
    const runtime = setup();
    await runtime.controller.startFeed("activity");
    runtime.emit({ kind: "live", since: "today", items: [] });
    await vi.waitFor(() =>
      expect(runtime.controller.getSnapshot().feed.kind).toBe("live"),
    );
    runtime.controller.stopFeed();
    expect(runtime.controller.getSnapshot().feed).toEqual({
      kind: "disconnected",
      since: "today",
      items: [],
    });
    expect(runtime.feedSignal()?.aborted).toBe(true);
    runtime.controller.dispose();
  });
  it("exposes missing feed permissions without opening a socket", async () => {
    const runtime = setup();
    runtime.change({
      kind: "blocked",
      reason: "scope",
      detail: "Grant AutoMod permissions",
    });
    runtime.controller.bindChannel(channel, 2);
    await runtime.controller.startFeed("automod");
    expect(runtime.controller.getSnapshot().feed).toEqual({
      kind: "permission",
      detail: "Grant AutoMod permissions",
      scopes: ["moderator:manage:automod"],
    });
    expect(runtime.feeds.subscribe).not.toHaveBeenCalled();
    runtime.controller.dispose();
  });
  it("rejects reward decisions without a loaded eligible pending request", async () => {
    const runtime = setup();
    await runtime.controller.execute({
      kind: "reward-decision",
      rewardId: "other",
      redemptionId: "unknown",
      status: "FULFILLED",
    });
    expect(runtime.gateway.execute).not.toHaveBeenCalled();
    expect(runtime.controller.getSnapshot().activity.kind).toBe("failure");
    runtime.controller.dispose();
  });
});
describe("durable local moderation history", () => {
  it("persists issued actions across repository restart, deduplicates events, and applies local retention days", async () => {
    let now = 40 * 86400000;
    const data = new Map<string, string>();
    const store = {
      read: async (key: string) => data.get(key) ?? null,
      write: async (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const log = createModerationLogRepository(store, () => now);
    const entry = {
      id: "event1",
      at: now,
      channel: { ...channel, platform: "kick" } as const,
      actorId: "10",
      userId: "20",
      action: "ban",
      detail: "spam",
      source: "app-observed",
      outcome: "confirmed",
    } as const;
    await Promise.all([
      log.record(entry),
      log.record(entry),
      log.record({
        ...entry,
        id: "issued2",
        source: "app-issued",
        at: now - 5 * 86400000,
      }),
    ]);
    expect(
      (
        await createModerationLogRepository(store, () => now).read(
          entry.channel,
          "10",
        )
      ).entries,
    ).toHaveLength(2);
    await log.setRetention(entry.channel, "10", 3);
    expect(await log.read(entry.channel, "10")).toEqual({
      retentionDays: 3,
      startedAt: now,
      entries: [entry],
    });
    now += 4 * 86400000;
    expect((await log.read(entry.channel, "10")).entries).toEqual([]);
    expect((await log.read(entry.channel, "another-account")).entries).toEqual(
      [],
    );
    await expect(log.setRetention(entry.channel, "10", 0)).rejects.toThrow(
      "1 to 365 days",
    );
  });
  it("records real moderation writes without converting local persistence failure into success", async () => {
    const record = vi.fn(async () => undefined);
    const controller = createModerationController({
      access: { read: async () => actor, subscribe: () => () => undefined },
      gateway: createModerationApi({
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      }),
      log: { read: vi.fn(), setRetention: vi.fn(), record },
    });
    await controller.selectChannel(channel);
    await controller.execute({ kind: "ban", userId: "20", reason: "spam" });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "20",
        action: "ban",
        detail: "spam",
        source: "app-issued",
        outcome: "confirmed",
      }),
    );
    controller.dispose();
  });
});
