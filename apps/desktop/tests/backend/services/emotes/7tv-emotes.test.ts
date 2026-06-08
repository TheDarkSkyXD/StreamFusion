import { beforeEach, describe, expect, it, vi } from "vitest";

// Guards: 7TV REST goes through electronAPI.emotes.* (main-process IPC) — calling browser fetch / ky for these endpoints reintroduces the DevTools red `Failed to load resource: ... 404` line PRD #62 closed
// Guards: 404 path is a null sentinel from main (NOT a thrown error) — the renderer logs at info and returns [] without ever hitting ApiClient[error]
// Guards: Kick without a resolved broadcaster user_id returns [] WITHOUT invoking electronAPI — addressing 7TV with the slug or chatroom id always 404s and undoes the noise reduction
// Guards: emotes are tagged with the emote-map key (channelId arg) not the 7TV identifier — splits the broadcaster's id (used to address 7TV) from the local key (used to look up emotes per slot)

const emotesApi = {
  get7TVUserByConnection: vi.fn(),
  get7TVGlobalEmoteSet: vi.fn(),
};

vi.stubGlobal("window", {
  electronAPI: {
    emotes: emotesApi,
  },
} as unknown as Window);

import { SevenTVEmoteProvider } from "@/backend/services/emotes/7tv-emotes";

// 7TV's GET /v3/users/{platform}/{id} returns a flat UserConnection:
// `emote_set` sits at the top level — no `connections[]` array. Confirmed
// against TWITCH and KICK on 2026-05-23.
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

describe("SevenTVEmoteProvider.fetchChannelEmotes", () => {
  beforeEach(() => {
    emotesApi.get7TVUserByConnection.mockReset();
    emotesApi.get7TVGlobalEmoteSet.mockReset();
  });

  it("Kick: invokes electronAPI.emotes.get7TVUserByConnection('kick', userId) and parses the flat emote_set", async () => {
    emotesApi.get7TVUserByConnection.mockResolvedValueOnce(flatUserConnection("KICK"));
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("12345", "xqc", "kick", "676");

    expect(emotesApi.get7TVUserByConnection).toHaveBeenCalledWith("kick", "676");
    expect(emotes).toHaveLength(1);
    expect(emotes[0].name).toBe("GAMBA");
    expect(emotes[0].provider).toBe("7tv");
    // Emotes are tagged with the emote-map key (chatroom/channel id),
    // NOT the broadcaster user_id 7TV indexes Kick by.
    expect(emotes[0].channelId).toBe("12345");
  });

  it("Twitch: invokes electronAPI.emotes.get7TVUserByConnection('twitch', channelId)", async () => {
    emotesApi.get7TVUserByConnection.mockResolvedValueOnce(flatUserConnection("TWITCH"));
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("71092938", "xqc", "twitch");

    expect(emotesApi.get7TVUserByConnection).toHaveBeenCalledWith("twitch", "71092938");
    expect(emotes).toHaveLength(1);
    expect(emotes[0].name).toBe("GAMBA");
  });

  it("Kick without a resolved user_id: returns [] WITHOUT invoking electronAPI (no 404 noise)", async () => {
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("12345", "xqc", "kick");

    expect(emotes).toEqual([]);
    expect(emotesApi.get7TVUserByConnection).not.toHaveBeenCalled();
  });

  it("returns [] on null sentinel from main (channel has no 7TV link)", async () => {
    emotesApi.get7TVUserByConnection.mockResolvedValueOnce(null);
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("71092938", "xqc", "twitch");

    expect(emotes).toEqual([]);
  });

  it("returns [] when a real failure surfaces (5xx, network), without crashing the caller", async () => {
    emotesApi.get7TVUserByConnection.mockRejectedValueOnce(new Error("7TV user fetch failed: 503"));
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchChannelEmotes("71092938", "xqc", "twitch");

    expect(emotes).toEqual([]);
  });
});

describe("SevenTVEmoteProvider.fetchGlobalEmotes", () => {
  beforeEach(() => {
    emotesApi.get7TVGlobalEmoteSet.mockReset();
  });

  it("invokes electronAPI.emotes.get7TVGlobalEmoteSet and parses the emote_set", async () => {
    emotesApi.get7TVGlobalEmoteSet.mockResolvedValueOnce({
      id: "global",
      emotes: [
        {
          id: "01F",
          name: "FeelsOkayMan",
          flags: 0,
          timestamp: 0,
          actor_id: null,
          data: {
            id: "01F",
            name: "FeelsOkayMan",
            flags: 0,
            lifecycle: 3,
            state: ["LISTED"],
            listed: true,
            animated: false,
            host: { url: "//cdn.7tv.app/emote/01F", files: [] },
          },
        },
      ],
    });
    const provider = new SevenTVEmoteProvider();

    const emotes = await provider.fetchGlobalEmotes();

    expect(emotesApi.get7TVGlobalEmoteSet).toHaveBeenCalledOnce();
    expect(emotes).toHaveLength(1);
    expect(emotes[0].name).toBe("FeelsOkayMan");
    expect(emotes[0].isGlobal).toBe(true);
  });
});
