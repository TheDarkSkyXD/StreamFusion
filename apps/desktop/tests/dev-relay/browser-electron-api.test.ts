import { describe, expect, it, vi } from "vitest";
import { createBrowserElectronApi } from "@/dev-relay/browser-electron-api";

// Guards: browser renderer invokes the same nested Electron API paths through the development relay
// Guards: playback URLs returned to the browser stay on the authenticated same-origin media proxy
// Guards: user-profile fixture queries cannot intercept unrelated Electron API methods
describe("browser Electron API relay", () => {
  it("forwards a nested method call and resolves its correlated result", async () => {
    const calls: Array<{ path: readonly string[]; args: readonly unknown[] }> = [];
    const api = createBrowserElectronApi({
      call: async (path, args) => {
        calls.push({ path, args });
        return { streams: [] };
      },
      subscribe: () => () => undefined,
    });

    await expect(api.streams.getTop({ platform: "twitch", limit: 12 })).resolves.toEqual({
      streams: [],
    });
    expect(calls).toEqual([
      {
        path: ["streams", "getTop"],
        args: [{ platform: "twitch", limit: 12 }],
      },
    ]);
  });

  it("relays the production user-profile bridge without a browser-only adapter", async () => {
    const call = vi.fn(async () => ({ state: "negative", source: "official" }));
    const api = createBrowserElectronApi({ call, subscribe: () => () => undefined });

    await expect(
      api.userProfiles.getTwitchFollow({
        broadcasterId: "channel",
        userId: "viewer",
        username: "viewer",
      })
    ).resolves.toEqual({ state: "negative", source: "official" });
    expect(call).toHaveBeenCalledWith(
      ["userProfiles", "getTwitchFollow"],
      [{ broadcasterId: "channel", userId: "viewer", username: "viewer" }]
    );
  });

  it("forwards Twitch badge catalog requests through the development relay", async () => {
    const result = {
      success: true,
      data: {
        global: { source: "gql", badges: [] },
        channel: { source: "persisted-gql", badges: [] },
      },
    };
    const call = vi.fn(async () => result);
    const api = createBrowserElectronApi({ call, subscribe: () => () => undefined });
    const request = {
      broadcasterId: "111",
      channelLogin: "ninja",
      forceRefresh: true,
    };

    await expect(api.chat.getTwitchBadgeCatalog(request)).resolves.toEqual(result);
    expect(call).toHaveBeenCalledWith(["chat", "getTwitchBadgeCatalog"], [request]);
  });

  it("relays Kick profile reads through the same production-shaped browser API", async () => {
    const result = {
      state: "known",
      source: "official",
      value: { userId: "123", username: "alice", displayName: "Alice", avatarUrl: "" },
    };
    const call = vi.fn(async (_path: readonly string[], _args: readonly unknown[]) => result);
    const api = createBrowserElectronApi({ call, subscribe: () => () => undefined });

    await expect(
      api.userProfiles.getKickIdentity({
        userId: "123",
        username: "alice",
        channelSlug: "streamer",
      })
    ).resolves.toEqual(result);
    const request = { userId: "123", username: "alice", channelSlug: "streamer" };
    await api.userProfiles.getKickAccountCreated(request);
    await api.userProfiles.getKickFollow(request);
    await api.userProfiles.resolveKickChannel({ username: "alice" });

    expect(call.mock.calls.map(([path, args]) => [path, args])).toEqual([
      [["userProfiles", "getKickIdentity"], [request]],
      [["userProfiles", "getKickAccountCreated"], [request]],
      [["userProfiles", "getKickFollow"], [request]],
      [["userProfiles", "resolveKickChannel"], [{ username: "alice" }]],
    ]);
  });

  it("passes loaded requests through to the relay and only forces the explicit unavailable state", async () => {
    const realResult = {
      state: "known",
      source: "first-party-fallback",
      value: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
      },
    };
    const relayCall = vi.fn(async () => realResult);
    const loaded = createBrowserElectronApi(
      { call: relayCall, subscribe: () => () => undefined },
      "?userProfileFixture=loaded"
    );
    await expect(
      loaded.userProfiles.getTwitchIdentity({ userId: "u1", username: "alice" })
    ).resolves.toEqual(realResult);
    expect(relayCall).toHaveBeenCalledWith(
      ["userProfiles", "getTwitchIdentity"],
      [{ userId: "u1", username: "alice" }]
    );

    const unavailable = createBrowserElectronApi(
      { call: relayCall, subscribe: () => () => undefined },
      "?userProfileFixture=unavailable"
    );
    await expect(
      unavailable.userProfiles.getTwitchFollow({
        broadcasterId: "c1",
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });
    expect(relayCall).toHaveBeenCalledOnce();
  });

  it("continues relaying unrelated methods when a user-profile fixture is active", async () => {
    const relayCall = vi.fn(async () => ({ streams: [] }));
    const api = createBrowserElectronApi(
      { call: relayCall, subscribe: () => () => undefined },
      "?userProfileFixture=unavailable"
    );

    await expect(api.streams.getTop({ platform: "twitch", limit: 12 })).resolves.toEqual({
      streams: [],
    });
    expect(relayCall).toHaveBeenCalledWith(
      ["streams", "getTop"],
      [{ platform: "twitch", limit: 12 }]
    );
  });

  it("returns a cleanup function that releases a relayed event subscription", () => {
    const unsubscribe = vi.fn();
    const listener = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const api = createBrowserElectronApi({
      call: vi.fn(),
      subscribe,
    });

    const cleanup = api.auth.onDeviceCodeStatus(listener);
    cleanup();

    expect(subscribe).toHaveBeenCalledWith(["auth", "onDeviceCodeStatus"], [], listener);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rewrites playback URLs without changing non-playback relay results", async () => {
    const api = createBrowserElectronApi({
      call: async () => ({
        success: true,
        data: {
          url: "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8?token=secret",
        },
      }),
      subscribe: () => () => undefined,
    });

    const result = await api.streams.getPlaybackUrl({
      platform: "twitch",
      channelSlug: "ninja",
    });

    expect(result.data?.url).toMatch(/^\/__streamfusion-dev\/media\?/);
    expect(result.data?.url).toContain("kind=media");
  });
});
