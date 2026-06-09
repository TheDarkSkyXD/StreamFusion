import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

// vi.mock is hoisted above imports, so the client constructor it references must
// be created via vi.hoisted (same pattern as follow-endpoints.test.ts).
const { ClientCtor } = vi.hoisted(() => ({ ClientCtor: vi.fn() }));
vi.mock("tmi.js", () => ({ default: { Client: ClientCtor } }));

import { TwitchChatService } from "@/backend/services/chat/twitch-chat";
import type { ChatMessage } from "@/shared/chat-types";
import { buildChannelKey, useChatStore } from "@/store/chat-store";

interface ServiceInternals {
  channels: Set<string>;
  channelUsers: Map<string, number>;
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
let fakeClient: EventEmitter & { connect: ReturnType<typeof vi.fn> };

describe("TwitchChatService connect() single-flight", () => {
  beforeEach(() => {
    fakeClient = Object.assign(new EventEmitter(), {
      connect: vi.fn(() => Promise.resolve(["irc-ws.chat.twitch.tv", 443])),
    });
    ClientCtor.mockReset();
    // Arrow functions cannot be used with `new`; use a regular function so that
    // `new tmi.Client(options)` in createClient() returns fakeClient correctly.
    ClientCtor.mockImplementation(function () {
      return fakeClient;
    });
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
});
