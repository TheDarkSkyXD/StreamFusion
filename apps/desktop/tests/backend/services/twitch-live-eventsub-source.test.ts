import { describe, expect, it, vi } from "vitest";

import {
  TwitchLiveEventSubSource,
  type TwitchLiveEventSubSourceDeps,
} from "@backend/services/twitch-live-eventsub-source";
import type { TwitchEventSubClient } from "@backend/api/platforms/twitch/twitch-eventsub-client";
import type {
  NotificationPayload,
  StreamOfflineEvent,
  StreamOnlineEvent,
} from "@backend/api/platforms/twitch/twitch-eventsub-types";
import type { AuthToken, LocalFollow, TwitchUser } from "@shared/auth-types";

function token(overrides: Partial<AuthToken> = {}): AuthToken {
  return {
    accessToken: "token-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function user(overrides: Partial<TwitchUser> = {}): TwitchUser {
  return {
    id: "self-1",
    login: "viewer",
    displayName: "Viewer",
    profileImageUrl: "https://example.com/viewer.png",
    createdAt: "2026-01-01T00:00:00.000Z",
    broadcasterType: "",
    ...overrides,
  };
}

function follow(overrides: Partial<LocalFollow> = {}): LocalFollow {
  return {
    id: "follow-alpha",
    platform: "twitch",
    channelId: "123",
    channelName: "alpha",
    displayName: "Alpha",
    profileImage: "https://example.com/alpha.png",
    followedAt: "2026-01-01T00:00:00.000Z",
    source: "twitch",
    ...overrides,
  };
}

function onlinePayload(event: Partial<StreamOnlineEvent> = {}): NotificationPayload<StreamOnlineEvent> {
  return {
    subscription: {
      id: "sub-online",
      type: "stream.online",
      version: "1",
      status: "enabled",
      cost: 0,
      condition: { broadcaster_user_id: "123" },
      transport: { method: "websocket", session_id: "sess-1" },
      created_at: "2026-01-01T00:00:00.000Z",
    },
    event: {
      id: "stream-1",
      broadcaster_user_id: "123",
      broadcaster_user_login: "alpha",
      broadcaster_user_name: "Alpha",
      type: "live",
      started_at: "2026-01-01T00:00:00.000Z",
      ...event,
    },
  };
}

function offlinePayload(
  event: Partial<StreamOfflineEvent> = {}
): NotificationPayload<StreamOfflineEvent> {
  return {
    subscription: {
      id: "sub-offline",
      type: "stream.offline",
      version: "1",
      status: "enabled",
      cost: 0,
      condition: { broadcaster_user_id: "123" },
      transport: { method: "websocket", session_id: "sess-1" },
      created_at: "2026-01-01T00:00:00.000Z",
    },
    event: {
      broadcaster_user_id: "123",
      broadcaster_user_login: "alpha",
      broadcaster_user_name: "Alpha",
      ...event,
    },
  };
}

function createClient() {
  const listeners = new Map<string, (payload: NotificationPayload<unknown>) => void>();
  const stateListeners: Array<(state: "idle" | "connecting" | "connected" | "reconnecting" | "error") => void> =
    [];
  const unsubs: Array<ReturnType<typeof vi.fn>> = [];
  const client: TwitchEventSubClient = {
    connectionState: "idle",
    subscribe: vi.fn((eventType, channelId, listener) => {
      listeners.set(`${eventType}:${channelId}`, listener as (payload: NotificationPayload<unknown>) => void);
      const unsubscribe = vi.fn();
      unsubs.push(unsubscribe);
      return unsubscribe;
    }),
    onConnectionStateChange: vi.fn((listener) => {
      stateListeners.push(listener);
      return vi.fn();
    }),
    close: vi.fn(),
  };
  return { client, listeners, stateListeners, unsubs };
}

function createSource(
  overrides: Partial<TwitchLiveEventSubSourceDeps> & {
    tokenValue?: AuthToken | null;
    userValue?: TwitchUser | null;
    follows?: LocalFollow[];
  } = {}
) {
  const eventSub = createClient();
  const deps: TwitchLiveEventSubSourceDeps = {
    getToken: vi.fn(() => overrides.tokenValue ?? token()),
    getUser: vi.fn(() => overrides.userValue ?? user()),
    getFollows: vi.fn(() => overrides.follows ?? [follow()]),
    getEventSubClient: vi.fn(() => eventSub.client),
    onOnline: vi.fn(),
    onOffline: vi.fn(),
    onCoverageDegraded: vi.fn(),
    ...overrides,
  };
  const source = new TwitchLiveEventSubSource(deps);
  return { source, deps, ...eventSub };
}

// Guards: Twitch EventSub live source must dispatch authenticated stream.online/offline events while preserving polling as the fallback path when subscriptions fail, auth disappears, or the cost budget cannot cover the follow list.
describe("TwitchLiveEventSubSource", () => {
  it("subscribes authenticated Twitch follows to stream online and offline events", () => {
    const { source, deps, client } = createSource({
      follows: [follow(), follow({ id: "guest-alpha", source: "guest" })],
    });

    source.sync();

    expect(deps.getEventSubClient).toHaveBeenCalledWith("token-1", "self-1", undefined);
    expect(client.subscribe).toHaveBeenCalledTimes(2);
    expect(client.subscribe).toHaveBeenNthCalledWith(
      1,
      "stream.online",
      "123",
      expect.any(Function)
    );
    expect(client.subscribe).toHaveBeenNthCalledWith(
      2,
      "stream.offline",
      "123",
      expect.any(Function)
    );
  });

  it("passes the configured Twitch client id into the EventSub client", () => {
    const { source, deps } = createSource({
      getClientId: vi.fn(() => "configured-client-id"),
    });

    source.sync();

    expect(deps.getEventSubClient).toHaveBeenCalledWith("token-1", "self-1", {
      clientId: "configured-client-id",
    });
  });

  it("dispatches online and offline EventSub deliveries into the live notification service", () => {
    const { source, deps, listeners } = createSource();

    source.sync();
    listeners.get("stream.online:123")?.(onlinePayload());
    listeners.get("stream.offline:123")?.(offlinePayload());

    expect(deps.onOnline).toHaveBeenCalledWith({
      platform: "twitch",
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Live now",
    });
    expect(deps.onOffline).toHaveBeenCalledWith({
      platform: "twitch",
      channelId: "123",
      channelName: "alpha",
    });
  });

  it("cleans up auth-only subscriptions when Twitch auth is unavailable", () => {
    const { source, deps, client, unsubs } = createSource();

    source.sync();
    vi.mocked(deps.getToken).mockReturnValue(null);
    vi.mocked(deps.getUser).mockReturnValue(null);
    vi.mocked(deps.getFollows).mockReturnValue([follow({ source: "guest" })]);
    source.sync();

    expect(unsubs).toHaveLength(2);
    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    expect(unsubs[1]).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(deps.onCoverageDegraded).not.toHaveBeenCalled();
  });

  it("reports degraded EventSub coverage without throwing so polling can continue", () => {
    const { source, deps } = createSource({
      getEventSubClient: vi.fn(() => {
        throw new Error("websocket unavailable");
      }),
    });

    expect(() => source.sync()).not.toThrow();

    expect(deps.onCoverageDegraded).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "twitch", reason: "subscription-failed" })
    );
  });

  it("does not create an impossible EventSub request storm when follows exceed Twitch's cost budget", () => {
    const follows = Array.from({ length: 6 }, (_, index) =>
      follow({
        id: `follow-${index}`,
        channelId: String(index + 1),
        channelName: `channel-${index}`,
      })
    );
    const { source, deps, client } = createSource({ follows });

    source.sync();
    source.sync();

    expect(deps.getEventSubClient).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(deps.onCoverageDegraded).toHaveBeenCalledOnce();
    expect(deps.onCoverageDegraded).toHaveBeenCalledWith({
      platform: "twitch",
      reason: "subscription-limit",
      message: expect.stringContaining("polling"),
    });
  });
});
