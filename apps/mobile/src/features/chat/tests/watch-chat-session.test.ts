import { describe, expect, it } from "vitest";

import type { WatchChatSocket } from "../capabilities/watch-chat";
import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import { normalizeTwitchLogin } from "../adapters/twitch-guest-irc";

function memorySocket(): WatchChatSocket {
  return {
    close() {
      this.onclose?.({ code: 1000 });
    },
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    send() {
      return undefined;
    },
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

// Guards: guest Twitch IRC and Kick Pusher sessions surface connecting, live, failed, and retry
describe("watch chat session", () => {
  it("opens Twitch IRC, then shows live PRIVMSG rows", () => {
    let socket: WatchChatSocket | null = null;
    const session = createWatchChatSession({
      fetch: async () => json({}),
      socketFactory: (url) => {
        expect(url).toContain("irc-ws.chat.twitch.tv");
        socket = memorySocket();
        return socket;
      },
    });
    session.attach({
      channelId: "1",
      channelName: "alice",
      platform: "twitch",
    });
    expect(session.snapshot().kind).toBe("connecting");
    socket?.onopen?.(undefined as never);
    expect(session.snapshot()).toMatchObject({ kind: "empty" });
    socket?.onmessage?.({
      data: "@display-name=Ada;id=m1 :ada!ada@ada.tmi.twitch.tv PRIVMSG #alice :hello",
    });
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [{ badges: [], displayName: "Ada", id: "m1", text: "hello" }],
    });
  });

  it("retries a failed Twitch socket and reads Kick chatroom then Pusher events", async () => {
    let twitch: WatchChatSocket | null = null;
    const twitchSession = createWatchChatSession({
      fetch: async () => json({}),
      socketFactory: () => {
        twitch = memorySocket();
        return twitch;
      },
    });
    twitchSession.attach({
      channelId: "1",
      channelName: "alice",
      platform: "twitch",
    });
    twitch?.onerror?.();
    expect(twitchSession.snapshot().kind).toBe("failed");
    twitchSession.retry();
    twitch?.onopen?.(undefined as never);
    expect(twitchSession.snapshot().kind).toBe("empty");

    let kick: WatchChatSocket | null = null;
    const kickSession = createWatchChatSession({
      fetch: async () => json({ chatroom: { id: 44 } }),
      socketFactory: (url) => {
        expect(url).toContain("pusher.com");
        kick = memorySocket();
        return kick;
      },
    });
    kickSession.attach({
      channelId: "22",
      channelName: "absi",
      platform: "kick",
    });
    for (let attempt = 0; attempt < 10 && kick === null; attempt += 1) {
      await Promise.resolve();
    }
    expect(kick).not.toBeNull();
    kick?.onmessage?.({
      data: JSON.stringify({
        data: "{}",
        event: "pusher:connection_established",
      }),
    });
    expect(kickSession.snapshot().kind).toBe("empty");
    kick?.onmessage?.({
      data: JSON.stringify({
        data: JSON.stringify({
          content: "yo",
          id: "k1",
          sender: { username: "Ada" },
        }),
        event: "App\\Events\\ChatMessageEvent",
      }),
    });
    expect(kickSession.snapshot()).toMatchObject({
      kind: "live",
      messages: [{ badges: [], displayName: "Ada", id: "k1", text: "yo" }],
    });
  });

  it("normalizes Twitch JOINs to lowercase login without a leading hash", () => {
    expect(normalizeTwitchLogin(" #CaseOh_ ")).toBe("caseoh_");
  });


});
