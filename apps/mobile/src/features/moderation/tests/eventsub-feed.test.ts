import { describe, expect, it, vi } from "vitest";
import type {
  ModerationChannel,
  ProviderCredential,
} from "../capabilities/moderation";
import {
  createEventSubFeed,
  feedSubscriptions,
  parseObservedEvent,
} from "../adapters/eventsub-feed";

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
const at = "2026-10-05T12:00:00Z";
function message(type: string, event: unknown, id = "message-1") {
  return {
    metadata: {
      message_id: id,
      message_type: "notification",
      message_timestamp: at,
    },
    payload: { subscription: { type }, event },
  };
}
function socket() {
  const value: Pick<WebSocket, "onmessage" | "onerror" | "onclose" | "close"> =
    { onmessage: null, onerror: null, onclose: null, close: vi.fn() };
  return {
    value,
    emit: async (message: unknown) => {
      if (value.onmessage)
        await Reflect.apply(value.onmessage, value, [
          new MessageEvent("message", { data: JSON.stringify(message) }),
        ]);
    },
    disconnect: () => {
      if (value.onclose)
        Reflect.apply(value.onclose, value, [new Event("close")]);
    },
  };
}
function welcome(id = "socket-1") {
  return {
    metadata: {
      message_id: id,
      message_type: "session_welcome",
      message_timestamp: at,
    },
    payload: { session: { id, keepalive_timeout_seconds: 30 } },
  };
}
describe("Twitch mobile EventSub transport", () => {
  it("creates official v2 held-message subscriptions and tracks hold/update transitions", async () => {
    const remote = socket();
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ data: [{ id: "subscription-1", status: "enabled" }] }),
      );
    const receive = vi.fn();
    const lease = new AbortController();
    await createEventSubFeed({
      fetch,
      createSocket: () => remote.value,
      now: () => at,
    }).subscribe(channel, actor, "automod", receive, lease.signal);
    expect(receive).toHaveBeenLastCalledWith({ kind: "connecting" });
    await remote.emit(welcome());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        type: "automod.message.hold",
        version: "2",
        condition: { broadcaster_user_id: "10", moderator_user_id: "10" },
        transport: { method: "websocket", session_id: "socket-1" },
      }),
    });
    expect(receive).toHaveBeenLastCalledWith({
      kind: "live",
      since: at,
      items: [],
    });
    const hold = message("automod.message.hold", {
      broadcaster_user_id: "10",
      user_id: "20",
      user_name: "Viewer",
      message_id: "held-1",
      message: { text: "Held text" },
    });
    await remote.emit(hold);
    await remote.emit(hold);
    expect(receive).toHaveBeenLastCalledWith({
      kind: "live",
      since: at,
      items: [
        {
          id: "message-1",
          occurredAt: at,
          userId: "20",
          name: "Viewer",
          detail: "Held text",
          action: "automod.message.hold",
          messageId: "held-1",
          status: "held",
          rewardId: null,
          redemptionId: null,
        },
      ],
    });
    await remote.emit(
      message(
        "automod.message.update",
        {
          broadcaster_user_id: "10",
          user_id: "20",
          user_name: "Viewer",
          message_id: "held-1",
          message: { text: "Held text" },
          status: "Approved",
        },
        "message-2",
      ),
    );
    expect(receive).toHaveBeenLastCalledWith({
      kind: "live",
      since: at,
      items: [],
    });
    lease.abort();
    expect(remote.value.close).toHaveBeenCalledTimes(1);
  });
  it("filters other-channel and malformed events and bounds the latest buffer", async () => {
    const remote = socket();
    const receive = vi.fn();
    const lease = new AbortController();
    await createEventSubFeed({
      fetch: vi
        .fn()
        .mockImplementation(async () =>
          Response.json({
            data: [{ id: "subscription-1", status: "enabled" }],
          }),
        ),
      createSocket: () => remote.value,
      now: () => at,
    }).subscribe(channel, actor, "activity", receive, lease.signal);
    await remote.emit(welcome());
    await remote.emit(
      message("channel.follow", {
        broadcaster_user_id: "other",
        user_id: "20",
        user_name: "Viewer",
      }),
    );
    expect(receive).toHaveBeenLastCalledWith({
      kind: "live",
      since: at,
      items: [],
    });
    for (let index = 0; index < 205; index++)
      await remote.emit(
        message(
          "channel.follow",
          { broadcaster_user_id: "10", user_id: "20", user_name: "Viewer" },
          `event-${index}`,
        ),
      );
    expect(receive.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: "live",
      items: expect.any(Array),
    });
    expect(receive.mock.calls.at(-1)?.[0].items).toHaveLength(200);
    expect(receive.mock.calls.at(-1)?.[0].items[0].id).toBe("event-204");
    remote.disconnect();
    expect(receive.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: "disconnected",
      since: at,
    });
    lease.abort();
  });
  it("keeps permission denial distinct from a connected empty queue", async () => {
    const remote = socket();
    const receive = vi.fn();
    const lease = new AbortController();
    await createEventSubFeed({
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
      createSocket: () => remote.value,
    }).subscribe(channel, actor, "automod", receive, lease.signal);
    await remote.emit(welcome());
    expect(receive).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "permission",
        scopes: ["moderator:manage:automod"],
      }),
    );
    expect(remote.value.close).toHaveBeenCalledTimes(1);
    lease.abort();
  });
  it("moves a provider reconnect lease without resubscribing or losing the old socket before welcome", async () => {
    const first = socket();
    const second = socket();
    const createSocket = vi
      .fn()
      .mockReturnValueOnce(first.value)
      .mockReturnValueOnce(second.value);
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ data: [{ id: "subscription-1", status: "enabled" }] }),
      );
    const receive = vi.fn();
    const lease = new AbortController();
    await createEventSubFeed({ fetch, createSocket, now: () => at }).subscribe(
      channel,
      actor,
      "whispers",
      receive,
      lease.signal,
    );
    await first.emit(welcome());
    await first.emit({
      metadata: {
        message_id: "reconnect",
        message_type: "session_reconnect",
        message_timestamp: at,
      },
      payload: {
        session: {
          id: "socket-1",
          reconnect_url: "wss://eventsub.wss.twitch.tv/ws?reconnect=opaque",
        },
      },
    });
    expect(first.value.close).not.toHaveBeenCalled();
    expect(createSocket).toHaveBeenLastCalledWith(
      "wss://eventsub.wss.twitch.tv/ws?reconnect=opaque",
    );
    await second.emit(welcome("socket-2"));
    expect(first.value.close).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenLastCalledWith({
      kind: "live",
      since: at,
      items: [],
    });
    lease.abort();
    expect(second.value.close).toHaveBeenCalledTimes(1);
  });
  it("disconnects after a missed keepalive and ignores callbacks after lease cancellation", async () => {
    vi.useFakeTimers();
    const remote = socket();
    const receive = vi.fn();
    const lease = new AbortController();
    try {
      await createEventSubFeed({
        fetch: vi
          .fn()
          .mockImplementation(async () =>
            Response.json({
              data: [{ id: "subscription-1", status: "enabled" }],
            }),
          ),
        createSocket: () => remote.value,
        now: () => at,
      }).subscribe(channel, actor, "whispers", receive, lease.signal);
      await remote.emit(welcome());
      await vi.advanceTimersByTimeAsync(32000);
      expect(receive).toHaveBeenLastCalledWith({
        kind: "disconnected",
        since: at,
        items: [],
      });
      const count = receive.mock.calls.length;
      lease.abort();
      await remote.emit(welcome());
      expect(receive).toHaveBeenCalledTimes(count);
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses account-scoped whisper routing and includes subscription events only with broadcaster scopes", () => {
    expect(feedSubscriptions(channel, actor, "whispers")).toEqual([
      {
        type: "user.whisper.message",
        version: "1",
        condition: { user_id: "10" },
      },
    ]);
    expect(
      feedSubscriptions(channel, actor, "activity").map((item) => item.type),
    ).not.toContain("channel.subscribe");
    expect(
      feedSubscriptions(
        channel,
        { ...actor, scopes: ["channel:read:subscriptions", "bits:read"] },
        "activity",
      ).map((item) => item.type),
    ).toContain("channel.subscribe");
    const whisper = message("user.whisper.message", {
      to_user_id: "10",
      from_user_id: "20",
      from_user_name: "Mod",
      whisper: { text: "Private" },
    });
    expect(parseObservedEvent(whisper, channel, "10")).toMatchObject({
      userId: "20",
      name: "Mod",
      detail: "Private",
    });
    expect(parseObservedEvent(whisper, channel, "other")).toBeNull();
  });
  it("normalizes observed moderation targets and suspicious/reward events without fabricating history", () => {
    expect(
      parseObservedEvent(
        message("channel.moderate", {
          broadcaster_user_id: "10",
          moderator_user_name: "Mod",
          action: "ban",
          ban: { user_id: "20", user_name: "Viewer", reason: "Spam" },
        }),
        channel,
        "10",
      ),
    ).toMatchObject({ userId: "20", action: "ban", detail: "Viewer · Spam" });
    expect(
      parseObservedEvent(
        message("channel.suspicious_user.message", {
          broadcaster_user_id: "10",
          user_id: "20",
          user_name: "Viewer",
          low_trust_status: "restricted",
          message: { message_id: "m1", text: "flagged" },
        }),
        channel,
        "10",
      ),
    ).toMatchObject({
      userId: "20",
      status: "restricted",
      messageId: "m1",
      detail: "flagged",
    });
    expect(
      parseObservedEvent(
        message("channel.channel_points_custom_reward_redemption.add", {
          broadcaster_user_id: "10",
          user_id: "20",
          user_name: "Viewer",
          id: "r1",
          user_input: "Please",
          status: "unfulfilled",
          reward: { id: "reward1", title: "Reward" },
        }),
        channel,
        "10",
      ),
    ).toMatchObject({
      userId: "20",
      rewardId: "reward1",
      redemptionId: "r1",
      status: "unfulfilled",
    });
  });
});
