import { describe, expect, it, vi } from "vitest";
import { createModerationApi } from "../adapters/moderation-api";
import type {
  ModerationChannel,
  ModerationCommand,
  ProviderCredential,
} from "../capabilities/moderation";

const twitch: ProviderCredential = {
  kind: "ready",
  platform: "twitch",
  accessToken: "access",
  clientId: "client",
  userId: "10",
  username: "owner",
  generation: 1,
  scopes: [],
};
const kick: ProviderCredential = { ...twitch, platform: "kick" };
const channel: ModerationChannel = {
  platform: "twitch",
  id: "20",
  login: "channel",
  name: "Channel",
};
const signal = new AbortController().signal;
describe("official mobile moderation transport", () => {
  it("reads every moderated-channel page and verifies a role from the provider", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [], pagination: { cursor: "page two" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              broadcaster_id: "20",
              broadcaster_login: "channel",
              broadcaster_name: "Channel",
            },
          ],
          pagination: {},
        }),
      );
    const result = await createModerationApi({ fetch }).verify(
      channel,
      twitch,
      signal,
    );
    expect(result).toEqual({ kind: "success", value: "moderator" });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://api.twitch.tv/helix/moderation/channels?user_id=10&first=100&after=page%20two",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer access", "Client-Id": "client" },
      signal,
    });
  });
  it("rejects an invented moderation role", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ data: [], pagination: {} }),
    );
    expect(
      await createModerationApi({ fetch }).verify(channel, twitch, signal),
    ).toMatchObject({ kind: "failure", reason: "permission" });
  });
  it.each([
    [
      { kind: "timeout", userId: "30", durationSeconds: 600, reason: "spam" },
      "POST",
      "/moderation/bans?broadcaster_id=20&moderator_id=10",
      { data: { user_id: "30", duration: 600, reason: "spam" } },
    ],
    [
      { kind: "ban", userId: "30", reason: "spam" },
      "POST",
      "/moderation/bans?broadcaster_id=20&moderator_id=10",
      { data: { user_id: "30", reason: "spam" } },
    ],
    [
      { kind: "unban", userId: "30" },
      "DELETE",
      "/moderation/bans?broadcaster_id=20&moderator_id=10&user_id=30",
      undefined,
    ],
    [
      { kind: "delete-message", messageId: "message/id" },
      "DELETE",
      "/moderation/chat?broadcaster_id=20&moderator_id=10&message_id=message%2Fid",
      undefined,
    ],
    [
      { kind: "automod", messageId: "held", action: "DENY" },
      "POST",
      "/moderation/automod/message",
      { user_id: "10", msg_id: "held", action: "DENY" },
    ],
  ] satisfies readonly (readonly [
    ModerationCommand,
    string,
    string,
    unknown,
  ])[])(
    "sends Twitch %j with official IDs and body",
    async (command, method, path, body) => {
      const fetch = vi.fn(async () => new Response(null, { status: 204 }));
      expect(
        await createModerationApi({ fetch }).execute(
          channel,
          command,
          twitch,
          signal,
        ),
      ).toEqual({ kind: "success", value: undefined });
      expect(fetch.mock.calls[0]?.[0]).toBe(
        `https://api.twitch.tv/helix${path}`,
      );
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        method,
        headers: { Authorization: "Bearer access", "Client-Id": "client" },
      });
      if (body !== undefined)
        expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual(body);
    },
  );
  it("sends Kick timeout in minutes and unban with its required DELETE body", async () => {
    const fetch = vi.fn(async () => Response.json({ data: {}, message: "OK" }));
    const api = createModerationApi({ fetch });
    const own: ModerationChannel = { ...channel, platform: "kick", id: "10" };
    expect(
      await api.execute(
        own,
        { kind: "timeout", userId: "30", durationSeconds: 600, reason: "spam" },
        kick,
        signal,
      ),
    ).toMatchObject({ kind: "success" });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      body: '{"broadcaster_user_id":10,"user_id":30,"reason":"spam","duration":10}',
      headers: {
        Authorization: "Bearer access",
        "Content-Type": "application/json",
      },
    });
    expect(
      await api.execute(own, { kind: "unban", userId: "30" }, kick, signal),
    ).toMatchObject({ kind: "success" });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      body: '{"broadcaster_user_id":10,"user_id":30}',
    });
  });
  it("verifies the Kick broadcaster using official channel data and deletes by message ID", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ broadcaster_user_id: 10 }] }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createModerationApi({ fetch });
    const own: ModerationChannel = { ...channel, platform: "kick", id: "10" };
    expect(await api.verify(own, kick, signal)).toEqual({
      kind: "success",
      value: "broadcaster",
    });
    expect(
      await api.execute(
        own,
        { kind: "delete-message", messageId: "msg-id" },
        kick,
        signal,
      ),
    ).toMatchObject({ kind: "success" });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://api.kick.com/public/v1/chat/msg-id",
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });
  it("parses settings and updates only supported mode fields", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              slow_mode: false,
              slow_mode_wait_time: null,
              follower_mode: true,
              follower_mode_duration: 10,
              subscriber_mode: false,
              emote_mode: true,
              unique_chat_mode: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: [] }));
    const api = createModerationApi({ fetch });
    const settings = {
      slowMode: false,
      slowSeconds: 30,
      followersOnly: true,
      followerMinutes: 10,
      subscribersOnly: false,
      emoteOnly: true,
      uniqueChat: false,
    };
    expect(await api.settings(channel, twitch, signal)).toEqual({
      kind: "success",
      value: settings,
    });
    expect(
      await api.execute(
        channel,
        { kind: "chat-settings", settings },
        twitch,
        signal,
      ),
    ).toMatchObject({ kind: "success" });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      body: '{"slow_mode":false,"follower_mode":true,"follower_mode_duration":10,"subscriber_mode":false,"emote_mode":true,"unique_chat_mode":false}',
    });
  });
  it("reads paginated banned users only for the broadcaster", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: [
          {
            user_id: "30",
            user_name: "Viewer",
            reason: "spam",
            expires_at: "",
          },
        ],
        pagination: { cursor: "next" },
      }),
    );
    const api = createModerationApi({ fetch });
    expect(
      await api.banned({ ...channel, id: "10" }, "older", twitch, signal),
    ).toEqual({
      kind: "success",
      value: {
        users: [{ id: "30", name: "Viewer", reason: "spam", expiresAt: "" }],
        cursor: "next",
      },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.twitch.tv/helix/moderation/banned?broadcaster_id=10&first=100&after=older",
    );
    expect(await api.banned(channel, null, twitch, signal)).toMatchObject({
      kind: "failure",
      reason: "unsupported",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, "auth"],
    [403, "permission"],
    [429, "rate-limit"],
    [500, "provider"],
  ])("does not confirm a %s response", async (status, reason) => {
    const fetch = vi.fn(
      async () => new Response("rejected", { status: Number(status) }),
    );
    expect(
      await createModerationApi({ fetch }).execute(
        channel,
        { kind: "ban", userId: "30", reason: "" },
        twitch,
        signal,
      ),
    ).toMatchObject({ kind: "failure", reason });
  });
  it("does not confirm an interrupted destructive request", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(
      await createModerationApi({ fetch }).execute(
        channel,
        { kind: "ban", userId: "30", reason: "" },
        twitch,
        signal,
      ),
    ).toMatchObject({
      kind: "failure",
      reason: "network",
      detail: expect.stringContaining("may have applied"),
    });
  });
});
