import { TWITCH_APP_SCOPES } from "@shared/auth-types";
import { describe, expect, it, vi } from "vitest";

import { createTwitchEventSubFeedService } from "@backend/features/moderation/adapters/twitch/twitch-eventsub-feed-service";

describe("Twitch EventSub feed service", () => {
  it("owns the channel.moderate subscription lifecycle and emits safe payloads", async () => {
    let eventListener: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const unsubscribeState = vi.fn();
    const client = {
      connectionState: "connected",
      subscribe: vi.fn((_type, _channelId, listener) => {
        eventListener = listener;
        return unsubscribe;
      }),
      onConnectionStateChange: vi.fn((listener) => {
        listener("connected");
        return unsubscribeState;
      }),
    };
    const getClient = vi.fn(() => client);
    const onEvent = vi.fn();
    const onState = vi.fn();
    const service = createTwitchEventSubFeedService({
      acquireLease: vi
        .fn()
        .mockResolvedValue({
          accessToken: "main-owned-token",
          userId: "200",
          scopes: TWITCH_APP_SCOPES,
          isCurrent: () => true,
          onCredentialsChanged: () => () => {},
        }),
      getClient,
    });

    await expect(
      service.start({ feedId: "feed-1", userId: "200", channelId: "100", onEvent, onState })
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(getClient).toHaveBeenCalledWith("main-owned-token", "200");
    expect(client.subscribe).toHaveBeenCalledWith(
      "channel.moderate",
      "100",
      expect.any(Function),
      expect.any(Function)
    );

    const payload = { event: { action: "delete", delete: { message_id: "message-1" } } };
    eventListener?.(payload);
    expect(onEvent).toHaveBeenCalledWith(payload);
    expect(onState).toHaveBeenCalledWith("connected");

    service.stop("feed-1");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribeState).toHaveBeenCalledOnce();
  });

  it("fails closed when main has no Twitch token", async () => {
    const service = createTwitchEventSubFeedService({
      acquireLease: vi.fn().mockResolvedValue(null),
      getClient: vi.fn(),
    });

    await expect(
      service.start({
        feedId: "feed-1",
        userId: "200",
        channelId: "100",
        onEvent: vi.fn(),
        onState: vi.fn(),
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("shares one authenticated client across AutoMod hold and update subscriptions and cleans both up", async () => {
    const unsubscribeHold = vi.fn();
    const unsubscribeUpdate = vi.fn();
    const unsubscribeState = vi.fn();
    const unsubscribes = [unsubscribeHold, unsubscribeUpdate];
    const client = {
      connectionState: "connected",
      subscribe: vi.fn((_type, _channelId, _listener) => unsubscribes.shift() ?? vi.fn()),
      onConnectionStateChange: vi.fn(() => unsubscribeState),
    };
    const service = createTwitchEventSubFeedService({
      acquireLease: vi
        .fn()
        .mockResolvedValue({
          accessToken: "main-owned-token",
          userId: "200",
          scopes: TWITCH_APP_SCOPES,
          isCurrent: () => true,
          onCredentialsChanged: () => () => {},
        }),
      getClient: vi.fn(() => client),
    });

    await service.start({
      feedId: "automod:100:200",
      userId: "200",
      channelId: "100",
      eventTypes: ["automod.message.hold", "automod.message.update"],
      onEvent: vi.fn(),
      onState: vi.fn(),
    });
    service.stop("automod:100:200");

    expect(client.subscribe).toHaveBeenNthCalledWith(
      1,
      "automod.message.hold",
      "100",
      expect.any(Function),
      expect.any(Function)
    );
    expect(client.subscribe).toHaveBeenNthCalledWith(
      2,
      "automod.message.update",
      "100",
      expect.any(Function),
      expect.any(Function)
    );
    expect(unsubscribes).toHaveLength(0);
    expect(unsubscribeHold).toHaveBeenCalledOnce();
    expect(unsubscribeUpdate).toHaveBeenCalledOnce();
    expect(unsubscribeState).toHaveBeenCalledOnce();
  });

  it("emits a feed-local permission state when an AutoMod subscription is rejected asynchronously", async () => {
    let rejectSubscription:
      | ((failure: {
          eventType: "automod.message.hold";
          channelId: string;
          status: number | null;
          code: "forbidden";
          message: string;
        }) => void)
      | undefined;
    const client = {
      connectionState: "connected",
      subscribe: vi.fn((_type, _channelId, _listener, onFailure) => {
        rejectSubscription = onFailure;
        return vi.fn();
      }),
      onConnectionStateChange: vi.fn(() => vi.fn()),
    };
    const onState = vi.fn();
    const service = createTwitchEventSubFeedService({
      acquireLease: vi
        .fn()
        .mockResolvedValue({
          accessToken: "main-owned-token",
          userId: "200",
          scopes: TWITCH_APP_SCOPES,
          isCurrent: () => true,
          onCredentialsChanged: () => () => {},
        }),
      getClient: vi.fn(() => client),
    });

    await service.start({
      feedId: "automod:100:200",
      userId: "200",
      channelId: "100",
      eventTypes: ["automod.message.hold"],
      onEvent: vi.fn(),
      onState,
    });
    rejectSubscription?.({
      eventType: "automod.message.hold",
      channelId: "100",
      status: 403,
      code: "forbidden",
      message: "missing scope",
    });

    expect(onState).toHaveBeenCalledWith("permission");
  });

  it("does not let global connection states overwrite a feed-local subscription failure", async () => {
    let rejectSubscription:
      | ((failure: {
          eventType: "automod.message.hold";
          channelId: string;
          status: number | null;
          code: "forbidden" | "unavailable";
          message: string;
        }) => void)
      | undefined;
    let emitState: ((state: string) => void) | undefined;
    const client = {
      connectionState: "connected",
      subscribe: vi.fn((_type, _channelId, _listener, onFailure) => {
        rejectSubscription = onFailure;
        return vi.fn();
      }),
      onConnectionStateChange: vi.fn((listener) => {
        emitState = listener;
        return vi.fn();
      }),
    };
    const onState = vi.fn();
    const service = createTwitchEventSubFeedService({
      acquireLease: vi
        .fn()
        .mockResolvedValue({
          accessToken: "main-owned-token",
          userId: "200",
          scopes: TWITCH_APP_SCOPES,
          isCurrent: () => true,
          onCredentialsChanged: () => () => {},
        }),
      getClient: vi.fn(() => client),
    });

    await service.start({
      feedId: "automod:100:200",
      userId: "200",
      channelId: "100",
      eventTypes: ["automod.message.hold"],
      onEvent: vi.fn(),
      onState,
    });
    rejectSubscription?.({
      eventType: "automod.message.hold",
      channelId: "100",
      status: 403,
      code: "forbidden",
      message: "missing scope",
    });
    emitState?.("connected");

    expect(onState.mock.calls.at(-1)).toEqual(["permission"]);
  });

  it("emits a feed-local error state when an AutoMod subscription fails without permission classification", async () => {
    let rejectSubscription:
      | ((failure: {
          eventType: "automod.message.hold";
          channelId: string;
          status: number | null;
          code: "unavailable";
          message: string;
        }) => void)
      | undefined;
    const client = {
      connectionState: "connected",
      subscribe: vi.fn((_type, _channelId, _listener, onFailure) => {
        rejectSubscription = onFailure;
        return vi.fn();
      }),
      onConnectionStateChange: vi.fn(() => vi.fn()),
    };
    const onState = vi.fn();
    const service = createTwitchEventSubFeedService({
      acquireLease: vi
        .fn()
        .mockResolvedValue({
          accessToken: "main-owned-token",
          userId: "200",
          scopes: TWITCH_APP_SCOPES,
          isCurrent: () => true,
          onCredentialsChanged: () => () => {},
        }),
      getClient: vi.fn(() => client),
    });

    await service.start({
      feedId: "automod:100:200",
      userId: "200",
      channelId: "100",
      eventTypes: ["automod.message.hold"],
      onEvent: vi.fn(),
      onState,
    });
    rejectSubscription?.({
      eventType: "automod.message.hold",
      channelId: "100",
      status: null,
      code: "unavailable",
      message: "socket hang up",
    });

    expect(onState).toHaveBeenCalledWith("error");
  });
});
