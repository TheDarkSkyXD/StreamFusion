import { describe, expect, it } from "vitest";

import { createTwitchGuestFollowedContentReader } from "../adapters/twitch/twitch-guest-followed-content-reader";
import { createKickGuestFollowedContentReader } from "../adapters/kick/kick-guest-followed-content-reader";

describe("guest followed live reads", () => {
  it.each([
    { label: "missing stream", user: { id: "twitch-id", login: "channel" } },
    {
      label: "malformed stream",
      user: { id: "twitch-id", login: "channel", stream: [] },
    },
    {
      label: "missing stream identity",
      user: { id: "twitch-id", login: "channel", stream: { title: "Live" } },
    },
    {
      label: "blank stream identity",
      user: { id: "twitch-id", login: "channel", stream: { id: " " } },
    },
    {
      label: "invalid stream identity",
      user: { id: "twitch-id", login: "channel", stream: { id: "bad/id" } },
    },
    {
      label: "GraphQL error",
      user: { id: "twitch-id", login: "channel", stream: null },
      errors: [{ message: "Stream unavailable", path: ["user", "stream"] }],
    },
  ])(
    "does not verify incomplete Twitch evidence as offline ($label)",
    async ({ user, ...fixture }) => {
      const reader = createTwitchGuestFollowedContentReader({
        fetch: async () =>
          new Response(JSON.stringify({ data: { user }, ...fixture })),
      });
      const outcome = await reader.readStreams({
        platform: "twitch",
        refs: [{ kind: "login", value: "channel" }],
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.verifiedOfflineChannelIds ?? []).toEqual([]);
      expect(outcome.items).toEqual([]);
    },
  );

  it.each([
    {},
    { livestream: [] },
    { livestream: { session_title: "Live" } },
    { livestream: { id: " " } },
    { livestream: { id: 0 } },
    { is_live: true },
    { livestream: { id: "bad/id" } },
    { livestream: { id: 500, is_live: "false" } },
    { is_live: "true", livestream: { id: 500 } },
  ])(
    "does not verify incomplete Kick evidence as offline (%j)",
    async (evidence) => {
      const reader = createKickGuestFollowedContentReader({
        liveCatalog: { read: async () => ({ kind: "ready", entries: [] }) },
        fetch: async () =>
          new Response(
            JSON.stringify({ id: 42, slug: "channel", ...evidence }),
          ),
      });
      const outcome = await reader.readStreams({
        platform: "kick",
        refs: [{ kind: "login", value: "channel" }],
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.verifiedOfflineChannelIds ?? []).toEqual([]);
      expect(outcome.items).toEqual([]);
    },
  );

  it("recognizes an explicit null Kick livestream as verified offline", async () => {
    const reader = createKickGuestFollowedContentReader({
      liveCatalog: { read: async () => ({ kind: "ready", entries: [] }) },
      fetch: async () =>
        new Response(
          JSON.stringify({ id: 42, slug: "channel", livestream: null }),
        ),
    });
    const outcome = await reader.readStreams({
      platform: "kick",
      refs: [{ kind: "login", value: "channel" }],
    });
    expect(outcome.status).toBe("complete");
    expect(outcome.verifiedOfflineChannelIds).toEqual(["42"]);
  });

  it("distinguishes a verified offline Twitch channel from a missing user", async () => {
    const reader = createTwitchGuestFollowedContentReader({
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const login = body.variables.login;
        return new Response(
          JSON.stringify({
            data: {
              user:
                login === "offline"
                  ? {
                      id: "twitch-id",
                      login: "offline",
                      displayName: "Offline",
                      stream: null,
                    }
                  : null,
            },
          }),
        );
      },
    });
    const outcome = await reader.readStreams({
      platform: "twitch",
      refs: [
        { kind: "login", value: "offline" },
        { kind: "login", value: "missing" },
      ],
    });
    expect(outcome.verifiedOfflineChannelIds).toEqual(["twitch-id"]);
  });

  it("honors explicit Kick offline even when a livestream object remains", async () => {
    const reader = createKickGuestFollowedContentReader({
      liveCatalog: { read: async () => ({ kind: "ready", entries: [] }) },
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: 42,
            slug: "offline",
            is_live: false,
            livestream: { id: 500, is_live: true, session_title: "Old" },
          }),
        ),
    });
    const outcome = await reader.readStreams({
      platform: "kick",
      refs: [
        { kind: "id", value: "42" },
        { kind: "login", value: "offline" },
      ],
    });
    expect(outcome.items).toEqual([]);
    expect(outcome.verifiedOfflineChannelIds).toEqual(["42"]);
  });
});
