import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TWITCH_APP_SCOPES } from "@shared/auth-types";
import { moderationFeedEventSchema } from "@shared/moderation-types";
import { executeTwitchModViewCommand } from "../../adapters/twitch/twitch-mod-view-reads";
import { twitchModViewCommandSchemas } from "../../routes/twitch-mod-view-command-schema";
import { createTwitchEventSubFeedService } from "../../adapters/twitch/twitch-eventsub-feed-service";
import type { ModerationAccountLease } from "../../adapters/twitch/moderation-account-lease";
import {
  TWITCH_EVENTSUB_CATALOG,
  eventSubCondition,
  eventSubRoutingId,
} from "@backend/api/platforms/twitch/twitch-eventsub-catalog";
import type { NotificationPayload } from "@backend/api/platforms/twitch/twitch-eventsub-types";

const actor = { broadcasterId: "100", moderatorId: "200" };
function lease(overrides: Partial<ModerationAccountLease> = {}): ModerationAccountLease {
  return {
    userId: "200",
    accessToken: "main-only",
    scopes: TWITCH_APP_SCOPES,
    isCurrent: () => true,
    onCredentialsChanged: () => () => {},
    ...overrides,
  };
}
function notification(id: string, channelId = "100"): NotificationPayload {
  return {
    metadata: {
      message_id: id,
      message_type: "notification",
      message_timestamp: "2026-09-06T12:00:00Z",
    },
    subscription: {
      id: "sub",
      type: "channel.follow",
      version: "2",
      status: "enabled",
      cost: 0,
      condition: { broadcaster_user_id: channelId, moderator_user_id: "200" },
      transport: { method: "websocket", session_id: "session" },
      created_at: "2026-09-06T11:59:00Z",
    },
    event: {
      broadcaster_user_id: channelId,
      user_id: "300",
      user_login: "viewer",
      user_name: "Viewer",
    },
  };
}

describe("Mod View provider contracts", () => {
  it("sends only supported reward decisions after app ownership and manage-scope checks", async () => {
    const command = {
      operation: "update-reward-redemption",
      broadcasterId: "200",
      rewardId: "owned",
      redemptionId: "redemption",
      status: "FULFILLED",
    } as const;
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "owned", title: "Reward", cost: 100 }] })
      .mockResolvedValueOnce({
        data: [
          {
            id: "redemption",
            user_id: "300",
            user_login: "viewer",
            user_name: "Viewer",
            user_input: "hello",
            status: "FULFILLED",
            redeemed_at: "now",
            reward: { id: "owned", title: "Reward", cost: 100 },
          },
        ],
      });
    expect(
      await executeTwitchModViewCommand({ request }, command, async () =>
        lease({ scopes: ["channel:read:redemptions"] })
      )
    ).toMatchObject({ ok: false, error: { code: "missing-scope" } });
    expect(request).not.toHaveBeenCalled();
    expect(
      await executeTwitchModViewCommand({ request }, command, async () => lease())
    ).toMatchObject({
      ok: true,
      data: { items: [{ redemptionId: "redemption", status: "fulfilled" }] },
    });
    expect(request).toHaveBeenLastCalledWith(
      "/channel_points/custom_rewards/redemptions?broadcaster_id=200&reward_id=owned&id=redemption",
      { method: "PATCH", body: JSON.stringify({ status: "FULFILLED" }) }
    );
    const schema = z.discriminatedUnion("operation", twitchModViewCommandSchemas);
    expect(schema.safeParse({ ...command, status: "UNFULFILLED" }).success).toBe(false);
    expect(schema.safeParse({ ...command, redemptionId: "" }).success).toBe(false);
  });

  it("uses documented suspicious status POST and DELETE contracts and requires confirmation", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ user_id: "300", status: "ACTIVE_MONITORING", updated_at: "now" }],
      })
      .mockResolvedValueOnce({
        data: [{ user_id: "300", status: "NO_TREATMENT", updated_at: "later" }],
      });
    const command = {
      operation: "set-suspicious-user-status",
      ...actor,
      userId: "300",
      status: "ACTIVE_MONITORING",
    } as const;
    expect(await executeTwitchModViewCommand({ request }, command, async () => lease())).toEqual({
      ok: true,
      data: { userId: "300", status: "ACTIVE_MONITORING", updatedAt: "now" },
    });
    expect(request).toHaveBeenLastCalledWith(
      "/moderation/suspicious_users?broadcaster_id=100&moderator_id=200",
      { method: "POST", body: JSON.stringify({ user_id: "300", status: "ACTIVE_MONITORING" }) }
    );
    expect(
      await executeTwitchModViewCommand(
        { request },
        { ...command, status: "NO_TREATMENT" },
        async () => lease()
      )
    ).toEqual({ ok: true, data: { userId: "300", status: "NO_TREATMENT", updatedAt: "later" } });
    expect(request).toHaveBeenLastCalledWith(
      "/moderation/suspicious_users?broadcaster_id=100&moderator_id=200&user_id=300",
      { method: "DELETE" }
    );
  });

  // Guards: individual authority/scope denial precedes network operations; invalid AutoMod inputs never reach Twitch.
  it("rejects mismatched actors and missing exact read scopes before reading", async () => {
    const request = vi.fn();
    expect(
      await executeTwitchModViewCommand(
        { request },
        { operation: "get-shield-mode", ...actor },
        async () => lease({ userId: "999" })
      )
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await executeTwitchModViewCommand(
        { request },
        { operation: "get-automod-settings", ...actor },
        async () => lease({ scopes: ["moderator:manage:automod"] })
      )
    ).toMatchObject({ ok: false, error: { code: "missing-scope" } });
    expect(request).not.toHaveBeenCalled();
  });

  it("normalizes Shield and passes read-or-manage authorization", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        {
          is_active: true,
          moderator_id: "200",
          moderator_login: "moderator",
          moderator_name: "Moderator",
          last_activated_at: "now",
        },
      ],
    });
    expect(
      await executeTwitchModViewCommand(
        { request },
        { operation: "get-shield-mode", ...actor },
        async () => lease({ scopes: ["moderator:manage:shield_mode"] })
      )
    ).toEqual({
      ok: true,
      data: {
        active: true,
        moderator: { id: "200", login: "moderator", displayName: "Moderator" },
        lastActivatedAt: "now",
      },
    });
    expect(request).toHaveBeenCalledWith(
      "/moderation/shield_mode?broadcaster_id=100&moderator_id=200",
      undefined
    );
  });

  it("validates AutoMod level combinations and blocked term bounds", () => {
    const schema = z.discriminatedUnion("operation", twitchModViewCommandSchemas);
    const command = { operation: "update-automod-settings", ...actor };
    for (const settings of [
      {},
      { overall_level: 5 },
      { overall_level: 2, aggression: 1 },
      { aggression: -1 },
      { extra: 2 },
    ])
      expect(schema.safeParse({ ...command, settings }).success).toBe(false);
    expect(schema.safeParse({ ...command, settings: { overall_level: 0 } }).success).toBe(true);
    expect(schema.safeParse({ ...command, settings: { aggression: 4, swearing: 1 } }).success).toBe(
      true
    );
    expect(schema.safeParse({ operation: "add-blocked-term", ...actor, text: "a" }).success).toBe(
      false
    );
  });

  it("maps blocked term pages and maps removal to the documented id query", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "term",
            text: "blocked phrase",
            created_at: "created",
            updated_at: "updated",
            expires_at: "",
          },
        ],
        pagination: { cursor: "next" },
      })
      .mockResolvedValueOnce(null);
    expect(
      await executeTwitchModViewCommand(
        { request },
        { operation: "get-blocked-terms", ...actor, after: "opaque+cursor" },
        async () => lease()
      )
    ).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: "term",
            text: "blocked phrase",
            createdAt: "created",
            updatedAt: "updated",
            expiresAt: null,
          },
        ],
        cursor: "next",
      },
    });
    expect(request.mock.calls[0]?.[0]).toContain("after=opaque%2Bcursor");
    await executeTwitchModViewCommand(
      { request },
      { operation: "remove-blocked-term", ...actor, termId: "term" },
      async () => lease()
    );
    expect(request).toHaveBeenLastCalledWith(
      "/moderation/blocked_terms?broadcaster_id=100&moderator_id=200&id=term",
      { method: "DELETE" }
    );
  });

  it("does not return stale account data after a provider request resolves", async () => {
    let current = true;
    const request = vi.fn().mockImplementation(async () => {
      current = false;
      return { data: [] };
    });
    expect(
      await executeTwitchModViewCommand(
        { request },
        { operation: "get-chatters", ...actor },
        async () => lease({ isCurrent: () => current })
      )
    ).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("intersects paged membership with an authorized roster without claiming full coverage", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          { user_id: "200", user_login: "mod", user_name: "Mod" },
          { user_id: "300", user_login: "viewer", user_name: "Viewer" },
        ],
        total: 300,
        pagination: { cursor: "more-chatters" },
      })
      .mockResolvedValueOnce({
        data: [{ user_id: "200", user_login: "mod", user_name: "Mod" }],
        pagination: { cursor: "more-mods" },
      });
    const result = await executeTwitchModViewCommand(
      { request },
      { operation: "get-active-moderators", broadcasterId: "200", moderatorId: "200" },
      async () => lease()
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        items: [{ id: "200", login: "mod", displayName: "Mod" }],
        cursor: "more-chatters",
        coverage: "chatters-page",
        rosterComplete: false,
      },
    });
    const forbidden = await executeTwitchModViewCommand(
      { request },
      { operation: "get-active-moderators", ...actor },
      async () => lease()
    );
    expect(forbidden).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refuses redemption reads for rewards not manageable by this app", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "owned", title: "Owned reward", cost: 100 }] });
    const result = await executeTwitchModViewCommand(
      { request },
      { operation: "get-reward-redemptions", broadcasterId: "200", rewardId: "foreign" },
      async () => lease()
    );
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toContain("only_manageable_rewards=true");
  });

  it("preserves provider errors and rejects malformed data", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("No channel access"), { status: 403 }))
      .mockResolvedValueOnce({ data: [{ is_active: "yes" }] });
    expect(
      await executeTwitchModViewCommand(
        { request },
        { operation: "get-shield-mode", ...actor },
        async () => lease()
      )
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      await executeTwitchModViewCommand(
        { request },
        { operation: "get-shield-mode", ...actor },
        async () => lease()
      )
    ).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
});

describe("Mod View feed isolation", () => {
  // Guards: correct EventSub versions/conditions and bounded dedupe cannot cross account/channel leases.
  it("uses explicit follow, raid, whisper and suspicious conditions", () => {
    expect(TWITCH_EVENTSUB_CATALOG["channel.follow"].version).toBe("2");
    expect(eventSubCondition("channel.follow", "100", "200")).toEqual({
      broadcaster_user_id: "100",
      moderator_user_id: "200",
    });
    expect(eventSubCondition("channel.suspicious_user.update", "100", "200")).toEqual({
      broadcaster_user_id: "100",
      moderator_user_id: "200",
    });
    expect(eventSubCondition("channel.raid", "100", "200")).toEqual({
      to_broadcaster_user_id: "100",
    });
    expect(eventSubCondition("user.whisper.message", "100", "200")).toEqual({ user_id: "200" });
    expect(eventSubRoutingId("channel.raid", { to_broadcaster_user_id: "100" })).toBe("100");
    expect(eventSubRoutingId("user.whisper.message", { user_id: "200" })).toBe("200");
  });

  it("drops wrong channels, duplicate events and events delivered after stop", async () => {
    let emit: (value: NotificationPayload) => void = () => {};
    const unsubscribe = vi.fn();
    const client = {
      connectionState: "connected",
      subscribe: vi.fn((_type, _channelId, listener) => {
        emit = listener;
        return unsubscribe;
      }),
      onConnectionStateChange: () => () => {},
    };
    const onEvent = vi.fn();
    const service = createTwitchEventSubFeedService({
      acquireLease: async () => lease(),
      getClient: () => client,
    });
    await service.start({
      feedId: "one",
      userId: "200",
      channelId: "100",
      eventTypes: ["channel.follow"],
      onEvent,
      onState: vi.fn(),
    });
    emit(notification("wrong", "999"));
    emit(notification("one"));
    emit(notification("one"));
    expect(onEvent).toHaveBeenCalledOnce();
    expect(moderationFeedEventSchema.parse(onEvent.mock.calls[0]?.[0])).toMatchObject({
      kind: "activity",
      action: "follow",
      accountId: "200",
      channelId: "100",
      user: { id: "300" },
    });
    for (let index = 0; index < 513; index++) emit(notification(`event-${index}`));
    emit(notification("one"));
    expect(onEvent).toHaveBeenCalledTimes(515);
    service.stop("one");
    emit(notification("late"));
    expect(onEvent).toHaveBeenCalledTimes(515);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("stops in-flight starts and denies broadcaster-only subscriptions to moderators", async () => {
    let resolve: (value: ModerationAccountLease) => void = () => {};
    const getClient = vi.fn();
    const service = createTwitchEventSubFeedService({
      acquireLease: () =>
        new Promise((done) => {
          resolve = done;
        }),
      getClient,
    });
    const pending = service.start({
      feedId: "pending",
      userId: "200",
      channelId: "100",
      onEvent: vi.fn(),
      onState: vi.fn(),
    });
    service.stop("pending");
    resolve(lease());
    expect(await pending).toMatchObject({ ok: false });
    const ownOnly = createTwitchEventSubFeedService({
      acquireLease: async () => lease(),
      getClient,
    });
    expect(
      await ownOnly.start({
        feedId: "sub",
        userId: "200",
        channelId: "100",
        eventTypes: ["channel.subscribe"],
        onEvent: vi.fn(),
        onState: vi.fn(),
      })
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("revalidates token rotation and never restores a different account", async () => {
    let changed = () => {};
    let current = true;
    const first = lease({
      isCurrent: () => current,
      onCredentialsChanged: (callback) => {
        changed = callback;
        return () => {};
      },
    });
    const rotated = lease({
      accessToken: "rotated",
      isCurrent: () => current,
      onCredentialsChanged: (callback) => {
        changed = callback;
        return () => {};
      },
    });
    const acquireLease = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(rotated)
      .mockResolvedValueOnce(lease({ userId: "999" }));
    const unsubscribe = vi.fn();
    const client = {
      connectionState: "connected",
      subscribe: vi.fn(() => unsubscribe),
      onConnectionStateChange: () => () => {},
    };
    const getClient = vi.fn(() => client);
    const onState = vi.fn();
    const service = createTwitchEventSubFeedService({ acquireLease, getClient });
    await service.start({
      feedId: "one",
      userId: "200",
      channelId: "100",
      eventTypes: ["channel.follow"],
      onEvent: vi.fn(),
      onState,
    });
    current = false;
    changed();
    current = true;
    await Promise.resolve();
    await Promise.resolve();
    expect(getClient).toHaveBeenLastCalledWith("rotated", "200");
    expect(unsubscribe).toHaveBeenCalledOnce();
    current = false;
    changed();
    await Promise.resolve();
    await Promise.resolve();
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith("permission");
  });

  it("cleans up a rejected subscription before an explicit retry", async () => {
    let reject: (value: {
      eventType: "channel.follow";
      channelId: string;
      status: number;
      code: "forbidden";
      message: string;
    }) => void = () => {};
    const unsubscribe = vi.fn();
    const client = {
      connectionState: "connected",
      subscribe: vi.fn((_type, _channelId, _listener, onFailure) => {
        reject = onFailure;
        return unsubscribe;
      }),
      onConnectionStateChange: () => () => {},
    };
    const onState = vi.fn();
    const service = createTwitchEventSubFeedService({
      acquireLease: async () => lease(),
      getClient: () => client,
    });
    const options = {
      feedId: "one",
      userId: "200",
      channelId: "100",
      eventTypes: ["channel.follow"] as const,
      onEvent: vi.fn(),
      onState,
    };
    await service.start(options);
    reject({
      eventType: "channel.follow",
      channelId: "100",
      status: 403,
      code: "forbidden",
      message: "Missing permission",
    });
    expect(onState).toHaveBeenLastCalledWith("permission");
    await service.start(options);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(client.subscribe).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith("connected");
    service.stop("one");
  });
});
