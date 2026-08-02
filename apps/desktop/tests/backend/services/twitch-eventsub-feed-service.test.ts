import { describe, expect, it, vi } from "vitest";

import { createTwitchEventSubFeedService } from "@/backend/services/twitch-eventsub-feed-service";

describe("Twitch EventSub feed service", () => {
  it("owns the channel.moderate subscription lifecycle and emits safe payloads", async () => {
    let eventListener: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const unsubscribeState = vi.fn();
    const client = {
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
      getValidAccessToken: vi.fn().mockResolvedValue("main-owned-token"),
      getClient,
    });

    await expect(
      service.start({ feedId: "feed-1", userId: "200", channelId: "100", onEvent, onState })
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(getClient).toHaveBeenCalledWith("main-owned-token", "200");
    expect(client.subscribe).toHaveBeenCalledWith("channel.moderate", "100", expect.any(Function));

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
      getValidAccessToken: vi.fn().mockResolvedValue(null),
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
});
