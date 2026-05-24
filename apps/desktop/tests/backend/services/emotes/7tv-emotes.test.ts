import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

import { SevenTVEmoteProvider } from "@/backend/services/emotes/7tv-emotes";

// 7TV's GET /v3/users/{platform}/{id} returns a flat *UserConnection*:
// `emote_set` sits at the TOP LEVEL — there is NO `connections[]` array.
// (`connections[]` only exists on the 7TV-native /users/{stvId} endpoint.)
// Verified live against both TWITCH and KICK on 2026-05-23.
function flatUserConnection(platform: "KICK" | "TWITCH") {
  return {
    id: "676",
    platform,
    username: "xqc",
    display_name: "xQc",
    linked_at: 1686942000451,
    emote_capacity: 1000,
    emote_set_id: "set-1",
    emote_set: {
      id: "set-1",
      name: "xQc's Emotes",
      flags: 0,
      tags: [],
      immutable: false,
      privileged: false,
      emote_count: 1,
      capacity: 1000,
      emotes: [
        {
          id: "01G3WEGZN0000ET2J0MQP5YJ0G",
          name: "GAMBA",
          flags: 0,
          timestamp: 1653443428000,
          actor_id: null,
          data: {
            id: "01G3WEGZN0000ET2J0MQP5YJ0G",
            name: "GAMBA",
            flags: 0,
            lifecycle: 3,
            state: ["LISTED"],
            listed: true,
            animated: true,
            host: { url: "//cdn.7tv.app/emote/01G3WEGZN0000ET2J0MQP5YJ0G", files: [] },
          },
        },
      ],
    },
  };
}

function mockJsonOnce(value: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.resolve(value) });
}

function mockRejectOnce(err: unknown) {
  getMock.mockReturnValueOnce({ json: () => Promise.reject(err) });
}

describe("SevenTVEmoteProvider.fetchChannelEmotes", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("Kick: queries /users/KICK/{kickUserId} and parses the flat emote_set", async () => {
    mockJsonOnce(flatUserConnection("KICK"));
    const provider = new SevenTVEmoteProvider();

    // channelId (1st arg) is the emote-map key (chatroom/channel id).
    // kickUserId (4th arg) is the broadcaster user_id 7TV indexes Kick by.
    const emotes = await provider.fetchChannelEmotes("12345", "xqc", "kick", "676");

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0][0]).toBe("https://7tv.io/v3/users/KICK/676");
    expect(emotes).toHaveLength(1);
    expect(emotes[0].name).toBe("GAMBA");
    expect(emotes[0].provider).toBe("7tv");
    // Emotes are tagged with the emote-map key, not the 7TV identifier.
    expect(emotes[0].channelId).toBe("12345");
  });

  it("Twitch: parses the flat emote_set (regression — endpoint has no connections[])", async () => {
    mockJsonOnce(flatUserConnection("TWITCH"));
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("71092938", "xqc", "twitch");

    expect(getMock.mock.calls[0][0]).toBe("https://7tv.io/v3/users/TWITCH/71092938");
    expect(emotes).toHaveLength(1);
    expect(emotes[0].name).toBe("GAMBA");
  });

  it("Kick without a resolved user_id: returns [] without hitting the slug (no 404 spam)", async () => {
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("12345", "xqc", "kick");

    expect(emotes).toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("returns [] on 404 (channel has no 7TV link)", async () => {
    mockRejectOnce({ response: { status: 404 } });
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("71092938", "xqc", "twitch");

    expect(emotes).toEqual([]);
  });
});
