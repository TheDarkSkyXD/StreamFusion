import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports, so the client constructor it references must
// be created via vi.hoisted (same pattern as follow-endpoints.test.ts).
const { ClientCtor } = vi.hoisted(() => ({ ClientCtor: vi.fn() }));
vi.mock("tmi.js", () => ({ default: { Client: ClientCtor } }));

import { TwitchChatService } from "@/backend/services/chat/twitch-chat";
import type {
  ChatMessage,
  ModeratorStateEvent,
  RoomStatePatchEvent,
  UserNotice,
} from "@/shared/chat-types";
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
  join: ReturnType<typeof vi.fn>;
  say: ReturnType<typeof vi.fn>;
};

function makeFakeTmiClient(): typeof fakeClient {
  return fakeClient;
}

// Guards: Twitch community gift USERNOTICE events emit an aggregate notice so the gifted-sub banner appears before recipient rows.
describe("TwitchChatService connect() single-flight", () => {
  beforeEach(() => {
    fakeClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
      join: vi.fn(() => Promise.resolve(["#xqc"])),
      say: vi.fn(() => Promise.resolve(["#xqc", "hello"])),
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
    useChatStore.setState({
      messagesByChannel: {},
      pausedChannels: new Set(),
    });
  });

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

  it("emits a roomState patch when Twitch rejects chat for phone verification", async () => {
    const service = new TwitchChatService();
    const internals = service as unknown as ServiceInternals;
    const roomStateEvents: RoomStatePatchEvent[] = [];
    service.on("roomState", (event) => roomStateEvents.push(event));

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

    expect(roomStateEvents).toEqual([
      {
        platform: "twitch",
        channel: "erobb221",
        channelId: "71092938",
        patch: { twitchVerification: "phone" },
        reason: "ws",
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

  it("keeps new auth credentials when already connected so channel subscriber badges can load", async () => {
    const service = new TwitchChatService();

    const connectPromise = service.connect({ anonymous: true });
    fakeClient.emit("connected", "irc-ws.chat.twitch.tv", 443);
    await connectPromise;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            set_id: "subscriber",
            versions: [
              {
                id: "3",
                image_url_1x: "https://static-cdn.jtvnw.net/badges/v1/custom-3/1",
                image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/custom-3/2",
                image_url_4x: "https://static-cdn.jtvnw.net/badges/v1/custom-3/3",
                title: "3-Month Subscriber",
                description: "3-Month Subscriber",
                click_action: null,
                click_url: null,
              },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await service.connect({
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
    await service.joinChannel("extraemily", "517475551");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twitch.tv/helix/chat/badges?broadcaster_id=517475551",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer tok",
          "Client-Id": "client-id",
        },
      })
    );
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
