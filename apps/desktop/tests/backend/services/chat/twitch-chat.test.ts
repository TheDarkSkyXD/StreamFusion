import { EventEmitter } from "node:events";
import type tmi from "tmi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports, so the client constructor it references must
// be created via vi.hoisted (same pattern as follow-endpoints.test.ts).
const { ClientCtor } = vi.hoisted(() => ({ ClientCtor: vi.fn() }));
vi.mock("tmi.js", () => ({ default: { Client: ClientCtor } }));

import { TwitchChatService } from "@backend/services/chat/twitch-chat";
import type {
  ChatMessage,
  ModeratorStateEvent,
  UserNotice,
  ViewerChatSendRestrictionEvent,
} from "@shared/chat-types";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

interface ServiceInternals {
  channels: Set<string>;
  channelUsers: Map<string, number>;
  broadcasterId: Map<string, string>;
}

function makeChatMessage(id: string, channel: string): ChatMessage {
  return {
    id,
    platform: "twitch",
    channel,
    userId: "user-1",
    username: "tester",
    displayName: "Tester",
    color: "#fff",
    content: [{ type: "text", content: "hello" }],
    badges: [],
    rawContent: "hello",
    timestamp: new Date(),
    type: "message",
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

function seedTwitchBucket(channel: string): string {
  const channelKey = buildChannelKey("twitch", channel);
  const message = makeChatMessage("m-1", channel);
  useChatStore.setState({
    messagesByChannel: { [channelKey]: [message] },
    pausedChannels: new Set([channelKey]),
  });
  return channelKey;
}

// A controllable stand-in for tmi.js's Client. connect() resolves immediately;
// the service treats the "connected" EVENT (not connect()'s resolution) as
// success, so the test drives completion by emitting "connected".
let fakeClient: EventEmitter & {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  readyState: ReturnType<typeof vi.fn>;
  join: ReturnType<typeof vi.fn>;
  say: ReturnType<typeof vi.fn>;
  mods: ReturnType<typeof vi.fn>;
  vips: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
  raw: ReturnType<typeof vi.fn>;
};

function makeFakeTmiClient(): typeof fakeClient {
  return fakeClient;
}

// Guards: Twitch community gift USERNOTICE events emit an aggregate notice so the gifted-sub banner appears before recipient rows.
// Guards: Anonymous Twitch viewers load badge catalogs through the Electron bridge without a renderer fetch or auth credentials.
// Guards: pending Twitch sends reserve rolling-window capacity before the IRC transport settles.
// Guards: failed Twitch sends release their reservation, while successful sends consume exactly one slot.
// Guards: pending Twitch replies consume the same rolling-window capacity before raw IRC settles.
// Guards: failed Twitch replies release their reservation, while successful replies consume exactly one slot.
// Guards: pending Twitch actions consume the shared rolling-window capacity before IRC transport settles.
// Guards: failed Twitch actions release their reservation, while successful actions consume exactly one slot.
// Guards: authenticated slash commands use Twitch's command transport, while list commands emit only their acknowledged result.
// Guards: rejected Twitch commands propagate to the composer so its draft can be restored for retry.
// Guards: a rapid remount waits for final-release teardown before opening its replacement Twitch connection.
// Guards: concurrent soft and hard shutdown calls share one physical Twitch disconnect.
// Guards: soft and final teardown do not ask tmi.js to disconnect a socket that is already closed.
// Guards: a null token refresh falls back to anonymous recovery without dropping tracked Twitch rooms.
// Guards: a successful token refresh uses the new credential while recovering every tracked Twitch room.
// Guards: a soft identity reset retains all desired rooms and the replacement socket rejoins each room once.
// Guards: the last room release cancels remaining restoration while a replacement JOIN is pending.
describe("TwitchChatService connect() single-flight", () => {
  beforeEach(() => {
    fakeClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
      disconnect: vi.fn(() => Promise.resolve()),
      readyState: vi.fn(() => "OPEN" as const),
      join: vi.fn(() => Promise.resolve(["#xqc"])),
      say: vi.fn(() => Promise.resolve(["#xqc", "hello"])),
      mods: vi.fn(() => Promise.resolve(["modder", "helper"])),
      vips: vi.fn(() => Promise.resolve([])),
      action: vi.fn(() => Promise.resolve(["#xqc", "waves"])),
      raw: vi.fn(() => Promise.resolve()),
    });
    ClientCtor.mockReset();
    // Arrow functions cannot be used with `new`; use a regular function so that
    // `new tmi.Client(options)` in createClient() returns fakeClient correctly.
    ClientCtor.mockImplementation(makeFakeTmiClient);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "electronAPI");
    useChatStore.setState({
      messagesByChannel: {},
      pausedChannels: new Set(),
    });
  });

  async function reconnectAfterRefresh(token: string | null) {
    vi.useFakeTimers();
    const tokenFetcher = vi.fn(async () => token);
    const identities: Array<tmi.Options["identity"]> = [];
    const replacementClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
      disconnect: vi.fn(() => Promise.resolve()),
      readyState: vi.fn(() => "OPEN" as const),
      join: vi.fn((channel: string) => Promise.resolve([`#${channel}`])),
    });
    ClientCtor.mockImplementation(function createTransport(options: tmi.Options) {
      identities.push(options.identity);
      return identities.length === 1 ? fakeClient : replacementClient;
    });

    const service = new TwitchChatService();
    service.on("error", () => {});
    const opening = service.connect({
      accessToken: "original-token",
      tokenFetcher,
      user: {
        id: "user-1",
        login: "tester",
        displayName: "Tester",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await opening;
    await service.joinChannel("first-channel");
    await service.joinChannel("second-channel");

    fakeClient.emit("disconnected", "network unavailable");
    await vi.advanceTimersByTimeAsync(5_000);
    replacementClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await vi.advanceTimersByTimeAsync(0);

    const replacementIdentity = identities[1];
    return {
      identitySupplied: replacementIdentity !== undefined,
      usedRefreshedToken: replacementIdentity?.password === "oauth:refreshed-token",
      isAuthenticated: service.getConnectionStatus().isAuthenticated,
      channels: service.getConnectionStatus().channels,
      joinedChannels: replacementClient.join.mock.calls.map(([channel]) => channel),
      refreshCalls: tokenFetcher.mock.calls.length,
    };
  }

  it("a concurrent second connect() rides the in-flight attempt instead of building a competing client", async () => {
    vi.useFakeTimers();
    const service = new TwitchChatService();

    // Two near-simultaneous connects (e.g. React StrictMode double-mount).
    const p1 = service.connect({ anonymous: true });
    const p2 = service.connect({ anonymous: true });

    // Let any "wait 100ms then take over" window elapse *before* the first
    // attempt has connected. The old code superseded here and built a 2nd
    // client; single-flight keeps awaiting the one in-flight attempt.
    await vi.advanceTimersByTimeAsync(100);
    expect(ClientCtor).toHaveBeenCalledTimes(1);
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);

    // Complete the in-flight attempt; both callers settle on it.
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([p1, p2]);

    expect(ClientCtor).toHaveBeenCalledTimes(1);
  });

  // Guards: an active Twitch chat survives outages longer than the former ten-attempt cutoff and keeps retrying at the capped cadence.
  it("retries active chat forever with 5s, 10s, 15s, then capped 30s delays", async () => {
    vi.useFakeTimers();
    const service = new TwitchChatService();
    const errors: Error[] = [];
    service.on("error", (error) => errors.push(error));

    const initialConnect = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;

    ClientCtor.mockImplementation(function makeFailingClient() {
      return Object.assign(new EventEmitter(), {
        connect: vi.fn(() => Promise.reject(new Error("network unavailable"))),
        disconnect: vi.fn(() => Promise.resolve()),
        join: vi.fn(() => Promise.resolve(["#xqc"])),
        say: vi.fn(() => Promise.resolve(["#xqc", "hello"])),
      });
    });

    fakeClient.emit("disconnected", "network unavailable");

    await vi.advanceTimersByTimeAsync(4_999);
    expect(ClientCtor).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ClientCtor).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(ClientCtor).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(ClientCtor).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(ClientCtor).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ClientCtor).toHaveBeenCalledTimes(5);

    // Eight more capped retries cross the old ten-attempt circuit breaker.
    await vi.advanceTimersByTimeAsync(8 * 30_000);
    expect(ClientCtor).toHaveBeenCalledTimes(13);
    expect(service.getConnectionStatus().state).toBe("reconnecting");
    expect(errors.some((error) => /max reconnection attempts/i.test(error.message))).toBe(false);
  });

  // Guards: duplicate disconnect notifications cannot fan out into competing Twitch reconnect attempts.
  it("coalesces duplicate disconnect notifications into one reconnect", async () => {
    vi.useFakeTimers();
    const service = new TwitchChatService();
    const initialConnect = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;

    fakeClient.emit("disconnected", "network unavailable");
    fakeClient.emit("disconnected", "network unavailable");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(ClientCtor).toHaveBeenCalledTimes(2);
  });

  // Guards: an intentional Twitch shutdown physically clears pending recovery and never resurrects the socket.
  it("clears the pending reconnect timer and does not reconnect after intentional shutdown", async () => {
    vi.useFakeTimers();
    const service = new TwitchChatService();
    const initialConnect = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;

    fakeClient.emit("disconnected", "network unavailable");
    expect(vi.getTimerCount()).toBe(1);
    await service.forceShutdown();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ClientCtor).toHaveBeenCalledTimes(1);
    expect(service.getConnectionStatus().state).toBe("disconnected");
  });

  // Guards: shutdown while an OAuth refresh is pending cannot resume reconnect and reactivate Twitch chat.
  it("does not reconnect when shutdown occurs during token refresh", async () => {
    vi.useFakeTimers();
    let resolveToken!: (token: string | null) => void;
    const tokenFetcher = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveToken = resolve;
        })
    );
    const service = new TwitchChatService();
    const initialConnect = service.connect({
      accessToken: "old-token",
      tokenFetcher,
      user: {
        id: "user-1",
        login: "tester",
        displayName: "Tester",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;

    fakeClient.emit("disconnected", "network unavailable");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tokenFetcher).toHaveBeenCalledTimes(1);

    await service.forceShutdown();
    resolveToken("fresh-token");
    await vi.advanceTimersByTimeAsync(0);

    expect(ClientCtor).toHaveBeenCalledTimes(1);
    expect(service.isServiceActive()).toBe(false);
    expect(service.getConnectionStatus().state).toBe("disconnected");
  });

  it("uses a refreshed token while recovering every tracked channel", async () => {
    const observed = await reconnectAfterRefresh("refreshed-token");

    expect(observed).toEqual({
      identitySupplied: true,
      usedRefreshedToken: true,
      isAuthenticated: true,
      channels: ["first-channel", "second-channel"],
      joinedChannels: ["first-channel", "second-channel"],
      refreshCalls: 1,
    });
  });

  it("falls back to anonymous recovery when token refresh returns null", async () => {
    const observed = await reconnectAfterRefresh(null);

    expect(observed).toEqual({
      identitySupplied: false,
      usedRefreshedToken: false,
      isAuthenticated: false,
      channels: ["first-channel", "second-channel"],
      joinedChannels: ["first-channel", "second-channel"],
      refreshCalls: 1,
    });
  });

  it("restores every desired channel once after a soft identity reset", async () => {
    const service = new TwitchChatService();
    const initialConnect = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;
    await service.joinChannel("first-channel");
    await service.joinChannel("second-channel");

    await service.disconnect();

    const replacementClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
      disconnect: vi.fn(() => Promise.resolve()),
      readyState: vi.fn(() => "OPEN" as const),
      join: vi.fn((channel: string) => Promise.resolve([`#${channel}`])),
    });
    ClientCtor.mockImplementationOnce(function makeReplacementClient() {
      return replacementClient;
    });
    const replacementConnect = service.connect({ anonymous: true });
    replacementClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await replacementConnect;

    expect(service.getConnectionStatus().channels).toEqual(["first-channel", "second-channel"]);
    expect(replacementClient.join.mock.calls).toEqual([["first-channel"], ["second-channel"]]);
  });

  it("cancels channel restoration when the last release wins the replacement race", async () => {
    const service = new TwitchChatService();
    service.acquire("first-channel");
    service.acquire("second-channel");
    const initialConnect = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;
    await service.joinChannel("first-channel");
    await service.joinChannel("second-channel");
    await service.disconnect();
    await service.release("first-channel");

    let finishJoin!: () => void;
    const replacementClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
      disconnect: vi.fn(() => Promise.resolve()),
      readyState: vi.fn(() => "OPEN" as const),
      join: vi.fn(
        () =>
          new Promise<[string]>((resolve) => {
            finishJoin = () => resolve(["#second-channel"]);
          })
      ),
      part: vi.fn((channel: string) => Promise.resolve([`#${channel}`])),
    });
    ClientCtor.mockImplementationOnce(function makeReplacementClient() {
      return replacementClient;
    });
    const replacementConnect = service.connect({ anonymous: true });
    replacementClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await Promise.resolve();
    expect(replacementClient.join).toHaveBeenCalledWith("second-channel");

    await service.release("second-channel");
    finishJoin();
    await replacementConnect;

    expect(replacementClient.join).toHaveBeenCalledTimes(1);
    expect(service.getConnectionStatus()).toMatchObject({
      state: "disconnected",
      channels: [],
    });
  });

  // Guards: replacement Twitch sockets must rejoin every desired IRC channel retained across an outage.
  it("rejoins tracked channels on the replacement client", async () => {
    vi.useFakeTimers();
    const service = new TwitchChatService();
    const initialConnect = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;
    await service.joinChannel("xqc");

    const replacementClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
      disconnect: vi.fn(() => Promise.resolve()),
      join: vi.fn(() => Promise.resolve(["#xqc"])),
      say: vi.fn(() => Promise.resolve(["#xqc", "hello"])),
    });
    ClientCtor.mockImplementationOnce(function makeReplacementClient() {
      return replacementClient;
    });

    fakeClient.emit("disconnected", "network unavailable");
    await vi.advanceTimersByTimeAsync(5_000);
    replacementClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await vi.advanceTimersByTimeAsync(0);

    expect(replacementClient.join).toHaveBeenCalledTimes(1);
    expect(replacementClient.join).toHaveBeenCalledWith("xqc");
  });

  // Guards: a timed-out Twitch connection attempt is fully detached so late events cannot create a zombie connection.
  it("tears down a timed-out client and ignores its late connected event", async () => {
    vi.useFakeTimers();
    const service = new TwitchChatService();
    service.on("error", vi.fn());

    const connectPromise = service.connect({ anonymous: true });
    const rejection = expect(connectPromise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;

    expect(fakeClient.disconnect).toHaveBeenCalledTimes(1);
    expect(fakeClient.listenerCount("connected")).toBe(0);
    expect(fakeClient.listenerCount("disconnected")).toBe(0);

    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    expect(service.getConnectionStatus().state).toBe("disconnected");
  });

  it("keeps a channel bucket while another panel still holds it, then evicts on the last release", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const channelKey = seedTwitchBucket("xqc");
    internals.channels.add("xqc");

    service.acquire("xqc");
    service.acquire("xqc");

    await service.release("xqc");

    expect(useChatStore.getState().messagesByChannel[channelKey]).toHaveLength(1);
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(true);
    expect(internals.channels.has("xqc")).toBe(true);

    await service.release("xqc");

    expect(useChatStore.getState().messagesByChannel[channelKey]).toBeUndefined();
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(false);
    expect(internals.channels.has("xqc")).toBe(false);
  });

  it("disconnects directly on the final release without waiting for a redundant PART", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const client = Object.assign(new EventEmitter(), {
      disconnect: vi.fn(() => Promise.resolve()),
      part: vi.fn(() => Promise.reject(new Error("No response from Twitch."))),
    });
    (service as unknown as { client: typeof client }).client = client;
    internals.channels.add("xqc");
    service.acquire("xqc");

    await service.release("xqc");

    expect(client.part).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(service.getActiveUserCount()).toBe(0);
  });

  it("clears local channel state when Twitch does not acknowledge PART", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const client = Object.assign(new EventEmitter(), {
      part: vi.fn(() => Promise.reject(new Error("No response from Twitch."))),
    });
    (service as unknown as { client: typeof client }).client = client;
    internals.channels.add("xqc");
    internals.broadcasterId.set("xqc", "123");

    await service.leaveChannel("xqc");

    expect(client.part).toHaveBeenCalledWith("xqc");
    expect(internals.channels.has("xqc")).toBe(false);
    expect(internals.broadcasterId.has("xqc")).toBe(false);
  });

  it("waits for a final-release shutdown before connecting the next panel", async () => {
    let finishDisconnect!: () => void;
    fakeClient.disconnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisconnect = resolve;
        })
    );
    const service = new TwitchChatService();
    service.acquire("xqc");
    const initialConnect = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await initialConnect;

    const replacementClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
      disconnect: vi.fn(() => Promise.resolve()),
      join: vi.fn(() => Promise.resolve(["#tumblurr"])),
      say: vi.fn(() => Promise.resolve(["#tumblurr", "hello"])),
      action: vi.fn(() => Promise.resolve(["#tumblurr", "waves"])),
      raw: vi.fn(() => Promise.resolve()),
    });
    ClientCtor.mockImplementationOnce(function makeReplacementClient() {
      return replacementClient;
    });

    const release = service.release("xqc");
    service.acquire("tumblurr");
    const reconnect = service.connect({ anonymous: true });
    await Promise.resolve();

    expect(ClientCtor).toHaveBeenCalledTimes(1);
    finishDisconnect();
    await release;
    await Promise.resolve();
    expect(service.getActiveUserCount()).toBe(1);
    replacementClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await reconnect;

    expect(ClientCtor).toHaveBeenCalledTimes(2);
    expect(service.getConnectionStatus().state).toBe("connected");
  });

  it("shares one physical disconnect across concurrent force shutdown calls", async () => {
    let finishDisconnect!: () => void;
    fakeClient.disconnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisconnect = resolve;
        })
    );
    const service = new TwitchChatService();
    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;

    const firstShutdown = service.forceShutdown();
    const secondShutdown = service.forceShutdown();

    expect(fakeClient.disconnect).toHaveBeenCalledTimes(1);
    finishDisconnect();
    await Promise.all([firstShutdown, secondShutdown]);

    expect(service.getConnectionStatus().state).toBe("disconnected");
  });

  it("shares one physical disconnect between soft and final teardown", async () => {
    let finishDisconnect!: () => void;
    fakeClient.disconnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDisconnect = resolve;
        })
    );
    const service = new TwitchChatService();
    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;

    const softDisconnect = service.disconnect();
    const finalShutdown = service.forceShutdown();

    expect(fakeClient.disconnect).toHaveBeenCalledTimes(1);
    finishDisconnect();
    await Promise.all([softDisconnect, finalShutdown]);
    expect(service.getConnectionStatus().state).toBe("disconnected");
  });

  it("skips the physical disconnect when the Twitch socket is already closed", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    fakeClient.readyState.mockReturnValue("CLOSED");

    await service.forceShutdown();

    expect(fakeClient.disconnect).not.toHaveBeenCalled();
    expect(service.getConnectionStatus().state).toBe("disconnected");
  });

  it("skips a soft disconnect when the Twitch socket is already closed", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    fakeClient.readyState.mockReturnValue("CLOSED");

    await service.disconnect();

    expect(fakeClient.disconnect).not.toHaveBeenCalled();
    expect(service.getConnectionStatus().state).toBe("disconnected");
  });

  it("evicts active channel buckets during force shutdown", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const channelKey = seedTwitchBucket("xqc");
    const client = Object.assign(new EventEmitter(), {
      disconnect: vi.fn(() => Promise.resolve()),
    });
    (service as unknown as { client: typeof client }).client = client;
    internals.channels.add("xqc");
    service.acquire("xqc");

    await service.forceShutdown();

    expect(useChatStore.getState().messagesByChannel[channelKey]).toBeUndefined();
    expect(useChatStore.getState().pausedChannels.has(channelKey)).toBe(false);
    expect(internals.channelUsers.has("xqc")).toBe(false);
  });

  it("emits a viewer-specific send restriction when Twitch rejects chat for phone verification", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const restrictionEvents: ViewerChatSendRestrictionEvent[] = [];
    service.on("viewerSendRestriction", (event) => restrictionEvents.push(event));

    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    internals.broadcasterId.set("erobb221", "71092938");

    fakeClient.emit(
      "notice",
      "#erobb221",
      "msg_requires_verified_phone_number",
      "A verified phone number is required to chat in this channel."
    );

    expect(restrictionEvents).toEqual([
      {
        platform: "twitch",
        channel: "erobb221",
        channelId: "71092938",
        restriction: "verification",
        requirement: "phone",
      },
    ]);
  });

  it("identifies email verification separately from phone verification", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const restrictionEvents: ViewerChatSendRestrictionEvent[] = [];
    service.on("viewerSendRestriction", (event) => restrictionEvents.push(event));

    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    internals.broadcasterId.set("ninja", "12345");

    fakeClient.emit(
      "notice",
      "#ninja",
      "msg_verified_email",
      "A verified email address is required to chat in this channel."
    );

    expect(restrictionEvents).toEqual([
      {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "verification",
        requirement: "email",
      },
    ]);
  });

  it("emits a viewer-specific banned restriction for Twitch msg_banned notices", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const restrictionEvents: ViewerChatSendRestrictionEvent[] = [];
    service.on("viewerSendRestriction", (event) => restrictionEvents.push(event));

    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    internals.broadcasterId.set("ninja", "12345");

    fakeClient.emit(
      "notice",
      "#ninja",
      "msg_banned",
      "You are permanently banned from talking in ninja's channel."
    );

    expect(restrictionEvents).toEqual([
      {
        platform: "twitch",
        channel: "ninja",
        channelId: "12345",
        restriction: "banned",
      },
    ]);
  });

  it("emits moderatorState when the signed-in user is modded and unmodded live", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const moderatorStateEvents: ModeratorStateEvent[] = [];
    service.on("moderatorState", (event) => moderatorStateEvents.push(event));

    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "mod-1",
        login: "modder",
        displayName: "Modder",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    internals.broadcasterId.set("ninja", "111");

    fakeClient.emit("mod", "#ninja", "Modder");
    fakeClient.emit("unmod", "#ninja", "modder");

    expect(moderatorStateEvents).toEqual([
      {
        platform: "twitch",
        channel: "ninja",
        channelId: "111",
        isModerator: true,
        reason: "ws",
      },
      {
        platform: "twitch",
        channel: "ninja",
        channelId: "111",
        isModerator: false,
        reason: "ws",
      },
    ]);
    expect(service.isModeratorIn("ninja")).toBe(false);
  });

  it("keeps authenticated IRC join working when the badge bridge rejects", async () => {
    const getTwitchBadgeCatalog = vi.fn(async () => {
      throw new Error("badge transport unavailable");
    });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { getTwitchBadgeCatalog } },
    });
    const service = new TwitchChatService();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const connectPromise = service.connect({
      accessToken: "tok",
      clientId: "client-id",
      user: {
        id: "mod-1",
        login: "modder",
        displayName: "Modder",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;

    await expect(service.joinChannel("extraemily", "517475551")).resolves.toBeUndefined();

    expect(getTwitchBadgeCatalog).toHaveBeenCalledTimes(1);
    expect(fakeClient.join).toHaveBeenCalledWith("extraemily");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Guards: a slow Twitch badge catalog must not delay the IRC channel join
  it("joins IRC while the badge catalog is still loading", async () => {
    let finishBadges: ((result: { success: false }) => void) | undefined;
    const getTwitchBadgeCatalog = vi.fn(
      () =>
        new Promise<{ success: false }>((resolve) => {
          finishBadges = resolve;
        })
    );
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { getTwitchBadgeCatalog } },
    });
    const service = new TwitchChatService();
    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;

    const joinPromise = service.joinChannel("extraemily", "517475551");
    await Promise.resolve();

    expect(fakeClient.join).toHaveBeenCalledWith("extraemily");
    finishBadges?.({ success: false });
    await joinPromise;
  });

  it("loads and resolves the badge catalog through IPC for an anonymous viewer", async () => {
    const getTwitchBadgeCatalog = vi.fn(async () => ({
      success: true,
      data: {
        global: {
          source: "gql" as const,
          badges: [
            {
              setId: "moderator",
              version: "1",
              imageUrl:
                "https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3",
              title: "Moderator",
            },
          ],
        },
        channel: { source: "gql" as const, badges: [] },
      },
    }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { chat: { getTwitchBadgeCatalog } },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new TwitchChatService();

    await expect(service.loadChannelBadges("ninja", "111")).resolves.toBe(true);

    expect(getTwitchBadgeCatalog).toHaveBeenCalledWith({
      broadcasterId: "111",
      channelLogin: "ninja",
      forceRefresh: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      service.resolveChannelBadges("ninja", [
        { setId: "moderator", version: "1", imageUrl: "", title: "" },
      ])
    ).toEqual([
      {
        setId: "moderator",
        version: "1",
        imageUrl: "https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3",
        title: "Moderator",
      },
    ]);
  });

  it("applies live moderator status to immediate self-echo badges", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const messages: ChatMessage[] = [];
    service.on("message", (message) => messages.push(message));

    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "mod-1",
        login: "modder",
        displayName: "Modder",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    internals.channels.add("ninja");
    internals.broadcasterId.set("ninja", "111");

    fakeClient.emit("mod", "#ninja", "modder");
    await service.sendMessage("ninja", "hello");
    fakeClient.emit("unmod", "#ninja", "modder");
    await service.sendMessage("ninja", "hello again");

    expect(messages[0].badges.some((badge) => badge.setId === "moderator")).toBe(true);
    expect(messages[1].badges.some((badge) => badge.setId === "moderator")).toBe(false);
  });

  it("rejects the 21st concurrent send before transport while 20 sends are pending", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "viewer-1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    await service.joinChannel("ninja");

    const pendingSends: Array<{
      resolve: (result: [string, string]) => void;
    }> = [];
    fakeClient.say.mockImplementation(
      (channel: string, message: string) =>
        new Promise<[string, string]>((resolve) => pendingSends.push({ resolve }))
    );

    const sends = Array.from({ length: 20 }, (_, index) =>
      service.sendMessage("ninja", `message-${index}`)
    );

    const rejectedSend = service.sendMessage("ninja", "message-20");
    expect(fakeClient.say).toHaveBeenCalledTimes(20);
    await expect(rejectedSend).rejects.toThrow("Message rate limit exceeded");

    pendingSends.forEach(({ resolve }, index) => resolve(["#ninja", `message-${index}`]));
    await Promise.all(sends);
  });

  it("restores capacity after a failed send and counts each successful send once", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "viewer-1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    await service.joinChannel("ninja");

    fakeClient.say.mockRejectedValueOnce(new Error("transport failed"));
    await expect(service.sendMessage("ninja", "failed-message")).rejects.toThrow(
      "transport failed"
    );

    fakeClient.say.mockResolvedValue(["#ninja", "sent"]);
    for (let index = 0; index < 20; index += 1) {
      await expect(service.sendMessage("ninja", `message-${index}`)).resolves.toBeUndefined();
    }

    await expect(service.sendMessage("ninja", "message-20")).rejects.toThrow(
      "Message rate limit exceeded"
    );
    expect(fakeClient.say).toHaveBeenCalledTimes(21);
  });

  it("rejects the 21st concurrent reply before raw transport while 20 replies are pending", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "viewer-1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    await service.joinChannel("ninja");

    const pendingReplies: Array<{ resolve: () => void }> = [];
    fakeClient.raw.mockImplementation(
      () => new Promise<void>((resolve) => pendingReplies.push({ resolve }))
    );

    const replies = Array.from({ length: 20 }, (_, index) =>
      service.sendReply("ninja", `parent-${index}`, `reply-${index}`)
    );

    const rejectedReply = service.sendReply("ninja", "parent-20", "reply-20");
    expect(fakeClient.raw).toHaveBeenCalledTimes(20);
    await expect(rejectedReply).rejects.toThrow("Message rate limit exceeded");

    pendingReplies.forEach(({ resolve }) => resolve());
    await Promise.all(replies);
  });

  it("restores reply capacity after a failed raw transport and counts successful replies once", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "viewer-1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    await service.joinChannel("ninja");

    fakeClient.raw.mockRejectedValueOnce(new Error("reply transport failed"));
    await expect(service.sendReply("ninja", "failed-parent", "failed-reply")).rejects.toThrow(
      "reply transport failed"
    );

    fakeClient.raw.mockResolvedValue(undefined);
    for (let index = 0; index < 20; index += 1) {
      await expect(
        service.sendReply("ninja", `parent-${index}`, `reply-${index}`)
      ).resolves.toBeUndefined();
    }

    await expect(service.sendReply("ninja", "parent-20", "reply-20")).rejects.toThrow(
      "Message rate limit exceeded"
    );
    expect(fakeClient.raw).toHaveBeenCalledTimes(21);
  });

  it("rejects the 21st concurrent action before transport while 20 actions are pending", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "viewer-1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    await service.joinChannel("ninja");

    const pendingActions: Array<{ resolve: (result: [string, string]) => void }> = [];
    fakeClient.action.mockImplementation(
      () => new Promise<[string, string]>((resolve) => pendingActions.push({ resolve }))
    );

    const actions = Array.from({ length: 20 }, (_, index) =>
      service.sendAction("ninja", `action-${index}`)
    );

    const rejectedAction = service.sendAction("ninja", "action-20");
    expect(fakeClient.action).toHaveBeenCalledTimes(20);
    await expect(rejectedAction).rejects.toThrow("Message rate limit exceeded");

    pendingActions.forEach(({ resolve }, index) => resolve(["#ninja", `action-${index}`]));
    await Promise.all(actions);
  });

  it("restores action capacity after a failed transport and counts successful actions once", async () => {
    const service = new TwitchChatService();
    const connectPromise = service.connect({
      accessToken: "tok",
      user: {
        id: "viewer-1",
        login: "viewer",
        displayName: "Viewer",
        profileImageUrl: "",
        createdAt: "",
        broadcasterType: "",
      },
    });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;
    await service.joinChannel("ninja");

    fakeClient.action.mockRejectedValueOnce(new Error("action transport failed"));
    await expect(service.sendAction("ninja", "failed-action")).rejects.toThrow(
      "action transport failed"
    );

    fakeClient.action.mockResolvedValue(["#ninja", "sent"]);
    for (let index = 0; index < 20; index += 1) {
      await expect(service.sendAction("ninja", `action-${index}`)).resolves.toBeUndefined();
    }

    await expect(service.sendAction("ninja", "action-20")).rejects.toThrow(
      "Message rate limit exceeded"
    );
    expect(fakeClient.action).toHaveBeenCalledTimes(21);
  });

  it("emits a community gift notice for Twitch mystery gift aggregates", async () => {
    const service = new TwitchChatService();
    const notices: UserNotice[] = [];
    service.on("userNotice", (notice) => notices.push(notice));

    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;

    fakeClient.emit(
      "submysterygift",
      "#ninja",
      "marshnman001",
      100,
      { plan: "1000", planName: "Tier 1", prime: false },
      {
        id: "gift-100",
        "user-id": "gifter-1",
        "display-name": "marshnman001",
        color: "#c084fc",
        "system-msg": "marshnman001 gifted 100 Tier 1 Subs to the channel!",
        "msg-param-mass-gift-count": "100",
      }
    );

    expect(notices).toEqual([
      expect.objectContaining({
        id: "gift-100",
        platform: "twitch",
        channel: "ninja",
        type: "submysterygift",
        userId: "gifter-1",
        username: "marshnman001",
        displayName: "marshnman001",
        color: "#c084fc",
        systemMessage: "marshnman001 gifted 100 Tier 1 Subs to the channel!",
        giftCount: 100,
      }),
    ]);
  });
});
