import { describe, expect, it, vi } from "vitest";

import { readWatchChatHistory } from "../adapters/watch-chat-history";
import { applyWatchChatModeration } from "../domain/apply-watch-chat-moderation";
import {
  parseKickChatEvent,
  parseTwitchChatEvent,
} from "../domain/watch-chat-events";

describe("guest chat events", () => {
  it("parses Twitch subscriptions, first messages, deletions, and user timeouts", () => {
    expect(
      parseTwitchChatEvent(
        "@id=n1;msg-id=resub;login=ada;display-name=Ada;system-msg=Ada\\shas\\ssubscribed\\sfor\\s3\\smonths!;tmi-sent-ts=123 :tmi.twitch.tv USERNOTICE #room",
      ),
    ).toMatchObject({
      kind: "message",
      message: {
        id: "n1",
        kind: "notice",
        noticeKind: "resub",
        text: "Ada has subscribed for 3 months!",
        receivedAt: 123,
      },
    });
    expect(
      parseTwitchChatEvent(
        "@id=m1;first-msg=1;tmi-sent-ts=100 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :hello",
      ),
    ).toMatchObject({
      kind: "message",
      message: { id: "m1", firstMessage: true, receivedAt: 100 },
    });
    expect(
      parseTwitchChatEvent(
        "@target-msg-id=m1;tmi-sent-ts=200 :tmi.twitch.tv CLEARMSG #room :hello",
      ),
    ).toEqual({
      kind: "delete",
      messageId: "m1",
      at: 200,
    });
    expect(
      parseTwitchChatEvent(
        "@target-user-id=u1;ban-duration=600;tmi-sent-ts=300 :tmi.twitch.tv CLEARCHAT #room :ada",
      ),
    ).toEqual({
      kind: "clear-user",
      username: "ada",
      userId: "u1",
      durationSeconds: 600,
      at: 300,
    });
    expect(
      parseTwitchChatEvent("@tmi-sent-ts=400 :tmi.twitch.tv CLEARCHAT #room"),
    ).toEqual({ kind: "clear-room", at: 400 });
  });

  it("parses Kick subscription, gift, raid, and moderation payloads", () => {
    expect(
      parseKickChatEvent("App\\Events\\SubscriptionEvent", {
        username: "Ada",
        months: 1,
      }),
    ).toMatchObject({
      kind: "message",
      message: {
        kind: "notice",
        noticeKind: "subscription",
        text: "Ada subscribed!",
      },
    });
    expect(
      parseKickChatEvent("App\\Events\\GiftedSubscriptionsEvent", {
        gifter_username: "Ada",
        gifted_usernames: ["Bob"],
      }),
    ).toMatchObject({
      kind: "message",
      message: {
        noticeKind: "gift",
        text: "Ada gifted a subscription to Bob!",
      },
    });
    expect(
      parseKickChatEvent("App\\Events\\StreamHostEvent", {
        host_username: "Ada",
        number_viewers: 12,
      }),
    ).toMatchObject({
      kind: "message",
      message: { noticeKind: "raid", text: "Ada is raiding with 12 viewers!" },
    });
    expect(
      parseKickChatEvent("App\\Events\\MessageDeletedEvent", {
        message: { id: "m1" },
        deleted_by: { username: "Mod" },
      }),
    ).toMatchObject({
      kind: "delete",
      messageId: "m1",
      actor: "Mod",
    });
    expect(
      parseKickChatEvent("App\\Events\\UserBannedEvent", {
        user: { id: 1, username: "Ada" },
        duration: 5,
        permanent: false,
      }),
    ).toMatchObject({
      kind: "clear-user",
      userId: "1",
      username: "Ada",
      durationSeconds: 300,
    });
    expect(
      parseKickChatEvent("App\\Events\\ChatroomClearEvent", {}),
    ).toMatchObject({ kind: "clear-room" });
  });

  it("preserves Kick deletion actor aliases without assigning an unknown moderator", () => {
    const deletion = "App\\Events\\MessageDeletedEvent";
    expect(
      parseKickChatEvent(deletion, {
        message: { id: "m1" },
        deletedBy: { display_name: "Channel Mod" },
      }),
    ).toMatchObject({ kind: "delete", actor: "Channel Mod" });
    expect(
      parseKickChatEvent(deletion, {
        message: { id: "m1" },
        bot: "bot",
      }),
    ).toMatchObject({ kind: "delete", actor: "Bot" });
    expect(
      parseKickChatEvent(deletion, {
        message: { id: "m1", auto_mod: { slug: "auto_mod" } },
      }),
    ).toMatchObject({ kind: "delete", actor: "AutoMod" });
    expect(
      parseKickChatEvent(deletion, {
        message: { id: "m1", actor: { name: "Nested Mod" } },
      }),
    ).toMatchObject({ kind: "delete", actor: "Nested Mod" });
    expect(
      parseKickChatEvent(deletion, {
        message: { id: "m1" },
        source: "automation",
      }),
    ).toMatchObject({ kind: "delete", actor: "automation" });
    expect(
      parseKickChatEvent(deletion, {
        message: { id: "m1", deleted_by: { id: 42 } },
      }),
    ).toEqual(expect.not.objectContaining({ actor: expect.anything() }));
  });

  it("marks retained messages and clears a room regardless of notice visibility", () => {
    const messages = [
      {
        id: "m1",
        displayName: "Ada",
        username: "ada",
        userId: "u1",
        text: "first",
        badges: [],
      },
      {
        id: "m2",
        displayName: "Bob",
        username: "bob",
        userId: "u2",
        text: "second",
        badges: [],
      },
    ];
    expect(
      applyWatchChatModeration(messages, {
        kind: "delete",
        messageId: "m1",
        at: 10,
        actor: "Mod",
      }),
    ).toMatchObject([
      { id: "m1", deletedAt: 10, deletedBy: "Mod", deletionKind: "message" },
      { id: "m2" },
    ]);
    expect(
      applyWatchChatModeration(messages, {
        kind: "clear-user",
        userId: "u1",
        at: 20,
        durationSeconds: 60,
      }),
    ).toMatchObject([
      { id: "m1", deletedAt: 20, deletionKind: "timeout" },
      { id: "m2" },
    ]);
    expect(
      applyWatchChatModeration(messages, { kind: "clear-room", at: 30 }),
    ).toEqual([]);
  });
});

describe("guest recent history", () => {
  it("keeps the newest Twitch messages in source order with server timestamps", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            messages: [
              "@id=old;tmi-sent-ts=100 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :old",
              "@id=new;tmi-sent-ts=200 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :new",
            ],
          }),
        ),
    );
    const history = await readWatchChatHistory({
      fetch,
      target: { platform: "twitch", channelId: "1", channelName: "room" },
      limit: 1,
      signal: new AbortController().signal,
    });
    expect(fetch.mock.calls[0]?.[0]).toContain("limit=1");
    expect(history).toMatchObject({
      kind: "loaded",
      messages: [{ id: "new", receivedAt: 200, isHistorical: true }],
    });
  });

  it("reverses Kick newest-first history and keeps only the requested number", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              messages: [
                {
                  id: "new",
                  content: "new",
                  created_at: "2026-01-02T00:00:00Z",
                  sender: { username: "Ada" },
                },
                {
                  id: "old",
                  content: "old",
                  created_at: "2026-01-01T00:00:00Z",
                  sender: { username: "Ada" },
                },
              ],
            },
          }),
        ),
    );
    const history = await readWatchChatHistory({
      fetch,
      target: { platform: "kick", channelId: "123", channelName: "room" },
      limit: 2,
      signal: new AbortController().signal,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://kick.com/api/v2/channels/123/messages",
    );
    expect(history.kind).toBe("loaded");
    if (history.kind === "loaded") {
      expect(history.messages.map((message) => message.id)).toEqual([
        "old",
        "new",
      ]);
      expect(history.messages[0]?.receivedAt).toBe(
        Date.parse("2026-01-01T00:00:00Z"),
      );
    }
  });

  it("resolves an official Kick channel key to the numeric public history id", async () => {
    const urls: string[] = [];
    const fetch = async (url: RequestInfo | URL): Promise<Response> => {
      urls.push(String(url));
      return new Response(
        JSON.stringify(
          urls.length === 1 ? { id: 123 } : { data: { messages: [] } },
        ),
      );
    };
    const result = await readWatchChatHistory({
      fetch,
      target: {
        platform: "kick",
        channelId: "channel_abc",
        channelName: "ada",
      },
      limit: 200,
      signal: new AbortController().signal,
    });
    expect(urls).toEqual([
      "https://kick.com/api/v1/channels/ada",
      "https://kick.com/api/v2/channels/123/messages",
    ]);
    expect(result).toEqual({ kind: "loaded", messages: [] });
  });
});
