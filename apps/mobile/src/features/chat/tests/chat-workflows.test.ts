import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedPlatformAccess,
  PlatformAccess,
} from "@mobile/features/auth/capabilities/platform-access";
import type {
  ChatCommands,
  ChatCommandResult,
} from "../capabilities/chat-interactions";
import { createPlatformChatCommands } from "../adapters/platform-chat-commands";
import { createChatInteractions } from "../domain/chat-interactions";
import {
  parseProviderEmotes,
  createProviderEmoteReader,
} from "../adapters/provider-emotes";
import {
  parseTwitchPrivmsg,
  appendWatchChatMessage,
} from "../domain/watch-chat-messages";
import { resolveMessageParts } from "../domain/message-parts";

const twitch = {
  channelId: "123",
  channelName: "channel",
  platform: "twitch",
} as const;
const account: PlatformAccess = {
  kind: "ready",
  platform: "twitch",
  accessToken: "production-test-token",
  clientId: "client",
  userId: "99",
  username: "viewer",
  generation: 1,
  scopes: ["user:write:chat"],
};
const access = (): AuthenticatedPlatformAccess => ({
  read: async () => account,
  subscribe: () => () => undefined,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("authenticated chat requests", () => {
  it("posts Twitch sender identity, grants and reply ID with exact headers", async () => {
    const read = vi.fn(async () => account);
    const fetch = vi.fn(async () =>
      json({ data: [{ is_sent: true, message_id: "m1" }] }),
    );
    const commands = createPlatformChatCommands({
      access: { read, subscribe: () => () => undefined },
      fetch,
      openUrl: async () => undefined,
    });
    expect(
      await commands.send(
        twitch,
        "hello",
        "reply1",
        new AbortController().signal,
      ),
    ).toEqual({ kind: "sent", messageId: "m1" });
    expect(read).toHaveBeenCalledWith("twitch", ["user:write:chat"]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.twitch.tv/helix/chat/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer production-test-token",
          "Client-Id": "client",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          broadcaster_id: "123",
          sender_id: "99",
          message: "hello",
          reply_parent_message_id: "reply1",
        }),
      }),
    );
  });
  it("resolves Kick user identity separately from the public channel ID and sends as user", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ data: [{ broadcaster_user_id: 456 }] }))
      .mockResolvedValueOnce(
        json({ data: { is_sent: true, message_id: "k1" } }),
      );
    const commands = createPlatformChatCommands({
      access: access(),
      fetch,
      openUrl: async () => undefined,
    });
    expect(
      await commands.send(
        { ...twitch, platform: "kick" },
        "hello",
        "reply",
        new AbortController().signal,
      ),
    ).toEqual({ kind: "sent", messageId: "k1" });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.kick.com/public/v1/channels?slug=channel",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Authorization: "Bearer production-test-token",
        },
      }),
    );
    expect(fetch).toHaveBeenLastCalledWith(
      "https://api.kick.com/public/v1/chat",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer production-test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          broadcaster_user_id: 456,
          type: "user",
          content: "hello",
          reply_to_message_id: "reply",
        }),
      }),
    );
  });
  it("never sends for missing grants or fixture credentials", async () => {
    const fetch = vi.fn();
    const commands = createPlatformChatCommands({
      access: {
        read: async () => ({
          kind: "blocked",
          reason: "fixture",
          detail: "Fixture credentials are disabled.",
        }),
        subscribe: () => () => undefined,
      },
      fetch,
      openUrl: async () => undefined,
    });
    expect(
      await commands.send(twitch, "hello", null, new AbortController().signal),
    ).toEqual({ kind: "blocked", detail: "Fixture credentials are disabled." });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("surfaces rejection, rate limits and uncertain delivery without reporting sent", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({
          data: [
            { is_sent: false, drop_reason: { message: "Followers only." } },
          ],
        }),
      )
      .mockResolvedValueOnce(json({}, 429))
      .mockRejectedValueOnce(new Error("lost"));
    const commands = createPlatformChatCommands({
      access: access(),
      fetch,
      openUrl: async () => undefined,
    });
    expect(
      await commands.send(twitch, "hi", null, new AbortController().signal),
    ).toEqual({ kind: "failed", detail: "Followers only." });
    expect(
      await commands.send(twitch, "hi", null, new AbortController().signal),
    ).toEqual({
      kind: "failed",
      detail: "Chat is rate limited. Wait before sending again.",
    });
    expect(
      (await commands.send(twitch, "hi", null, new AbortController().signal))
        .kind,
    ).toBe("uncertain");
  });
  it("blocks Twitch users with their real ID and hands reports to their platform page", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const openUrl = vi.fn(async () => undefined);
    const commands = createPlatformChatCommands({
      access: access(),
      fetch,
      openUrl,
    });
    const message = {
      id: "m1",
      userId: "2",
      username: "ada",
      displayName: "Ada",
      text: "Hi",
      badges: [],
    };
    expect(
      await commands.userAction(
        twitch,
        message,
        "block",
        new AbortController().signal,
      ),
    ).toEqual({ kind: "completed" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.twitch.tv/helix/users/blocks?target_user_id=2",
      expect.objectContaining({ method: "PUT" }),
    );
    await commands.userAction(
      twitch,
      message,
      "report",
      new AbortController().signal,
    );
    expect(openUrl).toHaveBeenCalledWith("https://www.twitch.tv/ada");
  });
});

describe("chat interaction lifecycle", () => {
  it.each(["receipt", "uncertain"])(
    "aborts a pending send on signout and preserves its %s outcome",
    async (outcome) => {
      let change: (() => void) | undefined;
      let resolve: ((result: ChatCommandResult) => void) | undefined;
      let sendingSignal: AbortSignal | undefined;
      let signedIn = true;
      const commands: ChatCommands = {
        subscribe: (listener) => {
          change = listener;
          return () => undefined;
        },
        access: async () => ({
          allowed: signedIn,
          detail: signedIn ? "Ready" : "Sign in",
        }),
        userAction: async () => ({ kind: "completed" }),
        send: async (_target, _text, _reply, signal) => {
          sendingSignal = signal;
          return new Promise((done) => {
            resolve = done;
          });
        },
      };
      const session = createChatInteractions(commands, {
        read: async () => ({ emotes: [], failures: [] }),
      });
      session.attach(twitch, false);
      await vi.waitFor(() => expect(session.snapshot().access).toBe("ready"));
      const sending = session.send("hello");
      expect(session.snapshot().sending).toBe(true);
      signedIn = false;
      change?.();
      const result: ChatCommandResult =
        outcome === "receipt"
          ? { kind: "sent", messageId: "late" }
          : { kind: "uncertain", detail: "Check chat before trying again." };
      resolve?.(result);
      expect(await sending).toEqual(result);
      expect(sendingSignal?.aborted).toBe(true);
      await vi.waitFor(() => expect(session.snapshot().access).toBe("blocked"));
      expect(session.snapshot().sending).toBe(false);
      session.dispose();
    },
  );
  it("does not send recorded chat and does not insert an optimistic row", async () => {
    const send = vi.fn(async (): Promise<ChatCommandResult> => ({
      kind: "sent",
      messageId: "actual",
    }));
    const session = createChatInteractions(
      {
        access: async () => ({ allowed: true, detail: "Ready" }),
        subscribe: () => () => undefined,
        send,
        userAction: async () => ({ kind: "completed" }),
      },
      { read: async () => ({ emotes: [], failures: [] }) },
    );
    session.attach(twitch, true);
    expect((await session.send("hello")).kind).toBe("blocked");
    expect(send).not.toHaveBeenCalled();
    session.attach(twitch, false);
    await vi.waitFor(() => expect(session.snapshot().access).toBe("ready"));
    expect(await session.send("hello")).toEqual({
      kind: "sent",
      messageId: "actual",
    });
    const message = {
      id: "actual",
      displayName: "Viewer",
      text: "hello",
      badges: [],
    };
    expect(appendWatchChatMessage([message], message)).toEqual([message]);
    session.dispose();
  });
});

describe("provider emotes and message parts", () => {
  it("rejects malformed successful payloads and accepts genuine empty inventories", () => {
    expect(() => parseProviderEmotes("twitch", {})).toThrow("Invalid Twitch");
    expect(() => parseProviderEmotes("7tv", {})).toThrow("Invalid 7TV");
    expect(parseProviderEmotes("twitch", { data: [] })).toEqual([]);
    expect(parseProviderEmotes("bttv", [])).toEqual([]);
    expect(parseProviderEmotes("ffz", { sets: {} })).toEqual([]);
  });
  it("parses the actual Twitch, 7TV, BTTV, FFZ and Kick inventory shapes", () => {
    expect(
      parseProviderEmotes("twitch", {
        data: [
          {
            id: "25",
            name: "Kappa",
            images: { url_2x: "https://twitch/image" },
          },
        ],
      })[0],
    ).toMatchObject({
      provider: "twitch",
      name: "Kappa",
      imageUrl: "https://twitch/image",
      insertion: "Kappa",
    });
    expect(
      parseProviderEmotes("7tv", {
        emote_set: {
          emotes: [
            {
              id: "7",
              name: "Wave",
              data: {
                host: {
                  url: "//cdn.7tv.app/emote/7",
                  files: [{ name: "2x.webp" }],
                },
              },
            },
          ],
        },
      })[0]?.imageUrl,
    ).toBe("https://cdn.7tv.app/emote/7/2x.webp");
    expect(
      parseProviderEmotes("bttv", {
        channelEmotes: [{ id: "b", code: "Yep" }],
        sharedEmotes: [],
      })[0]?.imageUrl,
    ).toBe("https://cdn.betterttv.net/emote/b/2x");
    expect(
      parseProviderEmotes("ffz", {
        sets: {
          "1": {
            emoticons: [{ id: 1, name: "Cool", urls: { "2": "//cdn.ffz/1" } }],
          },
        },
      })[0]?.imageUrl,
    ).toBe("https://cdn.ffz/1");
    expect(
      parseProviderEmotes("kick", [{ emotes: [{ id: 42, name: "Smile" }] }])[0]
        ?.insertion,
    ).toBe("[emote:42:Smile]");
  });
  it("keeps provider failures distinguishable from empty inventories", async () => {
    const reader = createProviderEmoteReader({
      access: access(),
      fetch: async () => json({}, 503),
    });
    expect(await reader.read(twitch, new AbortController().signal)).toEqual({
      emotes: [],
      failures: [
        "7TV global",
        "7TV channel",
        "Twitch",
        "BTTV global",
        "BTTV channel",
        "FFZ global",
        "FFZ channel",
      ],
    });
  });
  it("uses native Twitch emote spans, preserving colons and Unicode message positions", () => {
    const message = parseTwitchPrivmsg(
      "@display-name=Ada;id=m1;user-id=99;emotes=25:2-6 :ada!ada@ada.tmi.twitch.tv PRIVMSG #channel :😀 Kappa :ok",
    );
    expect(message?.text).toBe("😀 Kappa :ok");
    expect(message?.userId).toBe("99");
    expect(message?.parts).toEqual([
      { kind: "text", text: "😀 " },
      {
        kind: "emote",
        text: "Kappa",
        imageUrl:
          "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
      },
      { kind: "text", text: " :ok" },
    ]);
    expect(resolveMessageParts("Hi [emote:42:Smile]", [])).toEqual([
      { kind: "text", text: "Hi" },
      { kind: "text", text: " " },
      {
        kind: "emote",
        text: "Smile",
        imageUrl: "https://files.kick.com/emotes/42/fullsize",
      },
    ]);
  });
});
