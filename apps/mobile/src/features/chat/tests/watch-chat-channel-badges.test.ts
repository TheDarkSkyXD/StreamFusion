import { afterEach, describe, expect, it } from "vitest";

import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import type { WatchChatSocket } from "../capabilities/watch-chat";
import { resetTwitchGlobalBadgeCatalogForTests } from "../domain/twitch-global-badge-catalog";

function socket(): WatchChatSocket {
  return {
    close() {},
    send() {},
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
  };
}

const tick = async () => {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
};
const badge = (name: string, version = "12") => ({
  setID: "subscriber",
  version,
  imageURL: `https://static-cdn.jtvnw.net/badges/v1/${name}/3`,
  title: name,
});
const globalCatalog = () =>
  Response.json({
    data: {
      badges: [badge("global"), { ...badge("mod", "1"), setID: "moderator" }],
    },
  });
const history = () =>
  Response.json({
    messages: [
      "@id=history;badges=subscriber/12;tmi-sent-ts=100 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :history",
    ],
  });
const live =
  "@id=live;badges=subscriber/12,moderator/1;tmi-sent-ts=200 :ada!ada@ada.tmi.twitch.tv PRIVMSG #room :live";

describe("Watch channel badge hydration", () => {
  afterEach(resetTwitchGlobalBadgeCatalogForTests);

  it("hydrates retained history and live messages after channel artwork arrives", async () => {
    const irc = socket();
    let resolveCatalog: ((value: Response) => void) | undefined;
    const catalog = new Promise<Response>((resolve) => {
      resolveCatalog = resolve;
    });
    const session = createWatchChatSession({
      socketFactory: () => irc,
      fetch: async (url, init) => {
        if (String(url).includes("robotty")) return history();
        const body = JSON.parse(String(init?.body));
        return body.operationName === "Badges" ? globalCatalog() : catalog;
      },
    });
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    irc.onopen?.();
    await tick();
    irc.onmessage?.({ data: live });
    resolveCatalog?.(
      Response.json({
        data: { user: { broadcastBadges: [badge("channel")] } },
      }),
    );
    await tick();
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [
        {
          id: "history",
          isHistorical: true,
          badges: [{ imageUrl: badge("channel").imageURL }],
        },
        {
          id: "live",
          badges: [
            { imageUrl: badge("channel").imageURL },
            { imageUrl: badge("mod").imageURL },
          ],
        },
      ],
    });
    session.dispose();
  });

  it("resolves history received after the channel catalog and keeps moderation intact", async () => {
    const irc = socket();
    let resolveHistory: ((value: Response) => void) | undefined;
    const seed = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    const session = createWatchChatSession({
      socketFactory: () => irc,
      fetch: async (url, init) => {
        if (String(url).includes("robotty")) return seed;
        const body = JSON.parse(String(init?.body));
        return body.operationName === "Badges"
          ? globalCatalog()
          : Response.json({
              data: { user: { broadcastBadges: [badge("channel")] } },
            });
      },
    });
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    irc.onopen?.();
    await tick();
    irc.onmessage?.({
      data: "@target-msg-id=history;tmi-sent-ts=300 :tmi.twitch.tv CLEARMSG #room :history",
    });
    resolveHistory?.(history());
    await tick();
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [
        {
          id: "history",
          deletedAt: 300,
          badges: [{ imageUrl: badge("channel").imageURL }],
        },
      ],
    });
    session.dispose();
  });

  it("ignores artwork arriving for a previous channel", async () => {
    const sockets = [socket(), socket()];
    let resolveOld: ((value: Response) => void) | undefined;
    const old = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const session = createWatchChatSession({
      socketFactory: () => sockets.shift() ?? socket(),
      fetch: async (url, init) => {
        if (String(url).includes("robotty"))
          return Response.json({ messages: [] });
        const body = JSON.parse(String(init?.body));
        if (body.operationName === "Badges") return globalCatalog();
        return body.variables.id === "1"
          ? old
          : Response.json({
              data: { user: { broadcastBadges: [badge("new")] } },
            });
      },
    });
    const next = sockets[1];
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    session.attach({ platform: "twitch", channelId: "2", channelName: "room" });
    next?.onopen?.();
    next?.onmessage?.({ data: live });
    await tick();
    resolveOld?.(
      Response.json({ data: { user: { broadcastBadges: [badge("old")] } } }),
    );
    await tick();
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [
        {
          id: "live",
          badges: [
            { imageUrl: badge("new").imageURL },
            { imageUrl: badge("mod").imageURL },
          ],
        },
      ],
    });
    session.dispose();
  });

  it("keeps global artwork and live chat when both anonymous channel paths fail", async () => {
    const irc = socket();
    const session = createWatchChatSession({
      socketFactory: () => irc,
      fetch: async (url, init) => {
        if (String(url).includes("robotty")) return history();
        const body = JSON.parse(String(init?.body));
        return body.operationName === "Badges"
          ? globalCatalog()
          : new Response("Unavailable", { status: 503 });
      },
    });
    session.attach({ platform: "twitch", channelId: "1", channelName: "room" });
    irc.onopen?.();
    await tick();
    irc.onmessage?.({ data: live });
    await tick();
    session.retry();
    irc.onopen?.();
    await tick();
    expect(session.snapshot()).toMatchObject({
      kind: "live",
      messages: [
        { id: "history", badges: [{ imageUrl: badge("global").imageURL }] },
      ],
    });
    session.dispose();
  });

  it("hydrates recorded comments without changing snapshot identity on repeated reads", async () => {
    let resolveCatalog: ((value: Response) => void) | undefined;
    const catalog = new Promise<Response>((resolve) => {
      resolveCatalog = resolve;
    });
    const session = createWatchChatSession({
      fetch: async (_url, init) =>
        JSON.parse(String(init?.body)).operationName === "Badges"
          ? globalCatalog()
          : catalog,
      replayReader: {
        async read() {
          return {
            kind: "page",
            cursor: null,
            messages: [
              {
                id: "recorded",
                displayName: "Ada",
                text: "hello",
                offsetSeconds: 0,
                badges: [
                  {
                    setId: "subscriber",
                    version: "12",
                    imageUrl: "",
                    title: "subscriber",
                  },
                ],
              },
            ],
          };
        },
      },
    });
    session.attach({
      platform: "twitch",
      channelId: "1",
      channelName: "room",
      media: { id: "recording", kind: "video" },
    });
    await tick();
    resolveCatalog?.(
      Response.json({
        data: { user: { broadcastBadges: [badge("channel")] } },
      }),
    );
    await tick();
    const view = session.snapshot();
    expect(view).toMatchObject({
      kind: "live",
      messages: [
        { id: "recorded", badges: [{ imageUrl: badge("channel").imageURL }] },
      ],
    });
    expect(session.snapshot()).toBe(view);
    session.dispose();
  });
});
