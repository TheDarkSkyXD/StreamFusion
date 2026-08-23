import { describe, expect, it, vi } from "vitest";

import { getChannelsById } from "@/backend/api/platforms/twitch/endpoints/channel-endpoints";
import type { TwitchRequestor } from "@/backend/api/platforms/twitch/twitch-requestor";

function makeClient(responses: Record<string, unknown>): TwitchRequestor {
  return {
    request: vi.fn(async (endpoint: string) => {
      for (const [pattern, resp] of Object.entries(responses)) {
        if (endpoint.includes(pattern)) return resp;
      }
      return { data: [] };
    }),
  } as unknown as TwitchRequestor;
}

const CHANNEL = {
  broadcaster_id: "b1",
  broadcaster_login: "streamer",
  broadcaster_name: "Streamer",
  broadcaster_language: "en",
  game_id: "g1",
  game_name: "Just Chatting",
  title: "Hello",
  delay: 0,
  tags: [],
  content_classification_labels: [],
  is_branded_content: false,
};

const USER = {
  id: "b1",
  login: "streamer",
  display_name: "Streamer",
  type: "",
  broadcaster_type: "partner",
  description: "Cool streamer",
  profile_image_url: "https://img.twitch.tv/avatar.jpg",
  offline_image_url: "https://img.twitch.tv/offline.jpg",
  email: "test@test.com",
  created_at: "2020-01-01T00:00:00Z",
};

describe("getChannelsById", () => {
  it("returns empty array for empty input", async () => {
    const client = makeClient({});
    const result = await getChannelsById(client, []);
    expect(result).toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("throws when more than 100 IDs are provided", async () => {
    const client = makeClient({});
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    await expect(getChannelsById(client, ids)).rejects.toThrow("Cannot fetch more than 100");
  });

  it("returns unified channels merged with user data", async () => {
    const client = makeClient({
      "/channels": { data: [CHANNEL] },
      "/users": { data: [USER] },
    });

    const result = await getChannelsById(client, ["b1"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b1");
    expect(result[0].username).toBe("streamer");
    expect(result[0].avatarUrl).toBe("https://img.twitch.tv/avatar.jpg");
    expect(result[0].isPartner).toBe(true);
    expect(result[0].platform).toBe("twitch");
  });

  it("falls back to empty avatar when user data is missing", async () => {
    const client = makeClient({
      "/channels": { data: [CHANNEL] },
      "/users": { data: [] },
    });

    const result = await getChannelsById(client, ["b1"]);

    expect(result).toHaveLength(1);
    expect(result[0].avatarUrl).toBe("");
  });

  it("sends broadcaster_id params for channels and id params for users", async () => {
    const client = makeClient({
      "/channels": { data: [] },
      "/users": { data: [] },
    });

    await getChannelsById(client, ["b1", "b2"]);

    const requestMock = client.request as ReturnType<typeof vi.fn>;
    const channelEndpoint = requestMock.mock.calls[0][0] as string;
    expect(channelEndpoint).toContain("broadcaster_id=b1");
    expect(channelEndpoint).toContain("broadcaster_id=b2");

    const userEndpoint = requestMock.mock.calls[1][0] as string;
    expect(userEndpoint).toContain("id=b1");
    expect(userEndpoint).toContain("id=b2");
  });
});
