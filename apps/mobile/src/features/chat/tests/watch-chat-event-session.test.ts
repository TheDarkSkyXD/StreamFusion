import { describe, expect, it, vi } from "vitest";

import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import type { WatchChatSocket } from "../capabilities/watch-chat";

function socket(): WatchChatSocket {
  return {
    close() {
      this.onclose?.({ code: 1000 });
    },
    send() {},
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
  };
}

describe("watch chat event session", () => {
  it("applies deletion immediately even when its notice is hidden", () => {
    const irc = socket();
    const session = createWatchChatSession({
      fetch: async () => new Response("{}"),
      socketFactory: () => irc,
      eventPreferences: () => ({
        showUserNotices: false,
        showClearMsg: false,
        showClearChat: false,
        firstMsgHighlight: false,
        recentMessagesOnJoin: false,
        recentMessagesLimit: 200,
        deletedMessageDisplay: "tombstone",
      }),
    });
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    irc.onopen?.();
    irc.onmessage?.({
      data: "@id=m1;user-id=u1;first-msg=1;tmi-sent-ts=100 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :secret",
    });
    irc.onmessage?.({
      data: "@id=n1;msg-id=sub;system-msg=Ada\\ssubscribed! :tmi.twitch.tv USERNOTICE #room",
    });
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [{ id: "m1", firstMessage: true }],
    });
    irc.onmessage?.({
      data: "@target-msg-id=m1;tmi-sent-ts=200 :tmi.twitch.tv CLEARMSG #room :secret",
    });
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      moderationRevision: 1,
      messages: [{ id: "m1", deletedAt: 200, deletionKind: "message" }],
    });
    irc.onmessage?.({
      data: "@tmi-sent-ts=300 :tmi.twitch.tv CLEARCHAT #room",
    });
    expect(session.snapshot()).toMatchObject({
      kind: "empty",
      moderationRevision: 2,
    });
    session.dispose();
  });

  it("does not restore deleted content when history arrives after moderation", async () => {
    const irc = socket();
    let resolveHistory: ((response: Response) => void) | undefined;
    const history = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    const session = createWatchChatSession({
      fetch: async (url) =>
        String(url).includes("recent-messages.robotty.de")
          ? history
          : new Response("{}"),
      socketFactory: () => irc,
      eventPreferences: () => ({
        showUserNotices: true,
        showClearMsg: true,
        showClearChat: true,
        firstMsgHighlight: true,
        recentMessagesOnJoin: true,
        recentMessagesLimit: 200,
        deletedMessageDisplay: "audit",
      }),
    });
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    irc.onopen?.();
    irc.onmessage?.({
      data: "@target-msg-id=old;tmi-sent-ts=200 :tmi.twitch.tv CLEARMSG #room :secret",
    });
    resolveHistory?.(
      new Response(
        JSON.stringify({
          messages: [
            "@id=old;tmi-sent-ts=100 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :secret",
          ],
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(session.snapshot()).toMatchObject({
        kind: "live",
        moderationRevision: 1,
        messages: [
          { id: "old", isHistorical: true, receivedAt: 100, deletedAt: 200 },
        ],
      });
    });
    session.dispose();
  });

  it("reports a failed history read without failing live chat", async () => {
    const irc = socket();
    const session = createWatchChatSession({
      fetch: async (url) =>
        String(url).includes("recent-messages.robotty.de")
          ? new Response("Unavailable", { status: 503 })
          : new Response("{}"),
      socketFactory: () => irc,
    });
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    irc.onopen?.();
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
    expect(session.snapshot()).toMatchObject({
      kind: "empty",
      historyDetail:
        "Recent Twitch chat could not be loaded. Live chat is connected.",
    });
    irc.onmessage?.({
      data: "@id=m1 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :live",
    });
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      historyDetail:
        "Recent Twitch chat could not be loaded. Live chat is connected.",
      messages: [{ id: "m1", text: "live" }],
    });
    session.dispose();
  });

  it("keeps history buffered until the chat socket opens", async () => {
    const irc = socket();
    const session = createWatchChatSession({
      fetch: async (url) =>
        String(url).includes("recent-messages.robotty.de")
          ? new Response(
              JSON.stringify({
                messages: [
                  "@id=old;tmi-sent-ts=100 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :before",
                ],
              }),
            )
          : new Response("{}"),
      socketFactory: () => irc,
    });
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
    expect(session.snapshot().kind).toBe("connecting");
    irc.onopen?.();
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [{ id: "old", isHistorical: true, receivedAt: 100 }],
    });
    session.dispose();
  });
});
