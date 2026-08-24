import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIpcReplyMock } from "../../../helpers/ipc-reply-mock";

const getMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { KickEmoteProvider } from "@/backend/services/emotes/kick-emotes";

function mockJsonOnce(value: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.resolve(value) });
}

beforeEach(() => {
  getMock.mockReset();
  Reflect.set(window, "electronAPI", undefined);
});

// Guards: Kick emote transform — `subscribers_only` boolean threads to `subscribersOnly`, channelId is carried through, image URL construction. Private-method exercise; if `transformEmote` is renamed or made public the test imports surface a compile error before the runtime cast hides drift.

// transformEmote is private; we exercise it through fetchChannelEmotes' transform
// by reaching into the class. Vitest is happy to access private methods at runtime —
// the type signature is the only barrier and we cast through it for the test.
type TransformEmoteFn = (
  emote: { id: number; channel_id?: number; name: string; subscribers_only: boolean },
  channelId?: string,
  setName?: string | null
) => unknown;

function transform(): TransformEmoteFn {
  const provider = new KickEmoteProvider();
  return (provider as unknown as { transformEmote: TransformEmoteFn }).transformEmote.bind(
    provider
  );
}

describe("KickEmoteProvider.transformEmote", () => {
  it("threads subscribers_only: true through to subscribersOnly", () => {
    const out = transform()({ id: 1, name: "subEmote", subscribers_only: true }, "channel-42") as {
      subscribersOnly?: boolean;
    };
    expect(out.subscribersOnly).toBe(true);
  });

  it("threads subscribers_only: false through to subscribersOnly", () => {
    const out = transform()(
      { id: 2, name: "globalEmote", subscribers_only: false },
      "channel-42"
    ) as { subscribersOnly?: boolean };
    expect(out.subscribersOnly).toBe(false);
  });

  it("does not throw when subscribers_only is missing (defensive)", () => {
    expect(() => transform()({ id: 3, name: "weirdEmote" } as never, "channel-42")).not.toThrow();
  });

  it("preserves all other emote fields", () => {
    const out = transform()(
      { id: 99, name: "PogChamp", subscribers_only: true, channel_id: 1234 },
      "channel-99"
    ) as {
      id: string;
      name: string;
      provider: string;
      isGlobal: boolean;
      isAnimated: boolean;
      isZeroWidth: boolean;
      channelId?: string;
      urls: { url1x: string; url2x: string; url4x?: string };
      kickSection?: string;
    };
    expect(out.id).toBe("99");
    expect(out.name).toBe("PogChamp");
    expect(out.provider).toBe("kick");
    expect(out.isGlobal).toBe(false);
    expect(out.isAnimated).toBe(false);
    expect(out.isZeroWidth).toBe(false);
    expect(out.channelId).toBe("channel-99");
    expect(out.urls.url1x).toContain("/emotes/99/");
    expect(out.urls.url2x).toContain("/emotes/99/");
    expect(out.urls.url4x).toContain("/emotes/99/");
    expect(out.kickSection).toBe("channel");
  });

  it.each([
    { setName: "channel_set", kickSection: "channel", isGlobal: false },
    { setName: null, kickSection: "channel", isGlobal: false },
    { setName: "Global", kickSection: "global", isGlobal: true },
    { setName: "Emojis", kickSection: "emoji", isGlobal: true },
  ])(
    "maps KickTalk set '$setName' to kickSection=$kickSection",
    ({ setName, kickSection, isGlobal }) => {
      const out = transform()(
        { id: 123, name: "kickThing", subscribers_only: false },
        "channel-42",
        setName
      ) as { kickSection?: string; isGlobal: boolean };

      expect(out.kickSection).toBe(kickSection);
      expect(out.isGlobal).toBe(isGlobal);
    }
  );
});

// Guards: Kick channel emote loading uses the Electron bridge when available so expected Kick 404s stay out of renderer DevTools.
describe("KickEmoteProvider.fetchChannelEmotes", () => {
  it("loads channel emote sets through the Electron bridge without renderer fetches", async () => {
    const getChannelEmotes = createIpcReplyMock().mockResolvedValue({
      emoteSets: [
        {
          id: "set-1",
          name: "channel_set",
          emotes: [{ id: 10, name: "OfflineOkay", subscribers_only: false }],
        },
      ],
    });
    Reflect.set(window, "electronAPI", {
      emotes: {
        kick: {
          getChannelEmotes,
        },
      },
    });
    const provider = new KickEmoteProvider();
    provider.configure("kick-token");

    const result = await provider.fetchChannelEmotes("chatroom-1", "offline-channel", "kick");

    expect(getChannelEmotes).toHaveBeenCalledWith({
      slug: "offline-channel",
      accessToken: "kick-token",
    });
    expect(getMock).not.toHaveBeenCalled();
    expect(result.map((emote) => emote.name)).toEqual(["OfflineOkay"]);
  });

  it("returns empty channel emotes when the bridge reports an expected Kick miss", async () => {
    const getChannelEmotes = createIpcReplyMock().mockResolvedValue(null);
    Reflect.set(window, "electronAPI", {
      emotes: {
        kick: {
          getChannelEmotes,
        },
      },
    });
    const provider = new KickEmoteProvider();

    const result = await provider.fetchChannelEmotes("missing-channel", "missing-channel", "kick");

    expect(getChannelEmotes).toHaveBeenCalledOnce();
    expect(getMock).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe("KickEmoteProvider.fetchUserEmotes", () => {
  it("loads subscribed channels through the Electron Kick web-session bridge when available", async () => {
    const getUserSubscriptions = createIpcReplyMock().mockResolvedValue({
      data: [
        {
          channel: {
            id: 101,
            slug: "subbed-one",
            name: "SubbedOne",
            profile_pic: "https://example.test/subbed-one/avatar.webp",
          },
        },
      ],
    });
    Reflect.set(window, "electronAPI", {
      emotes: {
        kick: {
          getUserSubscriptions,
        },
      },
    });
    const provider = new KickEmoteProvider();
    mockJsonOnce([
      {
        id: "set-1",
        name: "channel_set",
        emotes: [
          { id: 10, name: "SubOne", subscribers_only: true },
          { id: 11, name: "FreeOne", subscribers_only: false },
        ],
      },
    ]);

    const result = await provider.fetchUserEmotes();

    expect(getUserSubscriptions).toHaveBeenCalledOnce();
    expect(getMock).toHaveBeenCalledOnce();
    expect(getMock.mock.calls[0][0]).toBe("https://kick.com/emotes/subbed-one");
    expect(result.map((emote) => emote.name)).toEqual(["SubOne"]);
    expect(result[0]?.owner?.displayName).toBe("SubbedOne");
  });

  it("does not call Kick's web-only subscriptions endpoint directly when the bridge is missing", async () => {
    const provider = new KickEmoteProvider();
    provider.configure("kick-token");

    const result = await provider.fetchUserEmotes();

    expect(result).toEqual([]);
    expect(getMock).not.toHaveBeenCalledWith(
      "https://kick.com/api/v2/user/subscriptions",
      expect.anything()
    );
  });
});
