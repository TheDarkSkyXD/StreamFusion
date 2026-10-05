import { describe, expect, it, vi } from "vitest";
import { createModerationApi } from "../adapters/moderation-api";
import { createModerationController } from "../domain/moderation-controller";
import type {
  ModerationChannel,
  ProviderCredential,
} from "../capabilities/moderation";

const credential: ProviderCredential = {
  kind: "ready",
  platform: "twitch",
  accessToken: "token",
  clientId: "client",
  userId: "10",
  username: "owner",
  generation: 1,
  scopes: [],
};
const channel: ModerationChannel = {
  platform: "twitch",
  id: "10",
  login: "owner",
  name: "Owner",
};
const signal = new AbortController().signal;
describe("Twitch channel review and membership tools", () => {
  it("reads pending requests, approves through official query parameters, and invalidates the list", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "appeal",
              user_id: "30",
              user_name: "Viewer",
              text: "Please unban",
              status: "pending",
            },
          ],
          pagination: {},
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "appeal", status: "approved" }] }),
      );
    const gateway = createModerationApi({ fetch });
    const controller = createModerationController({
      access: {
        read: async () => credential,
        subscribe: () => () => undefined,
      },
      gateway,
    });
    await controller.selectChannel(channel);
    await controller.readReview("unban-requests");
    expect(controller.getSnapshot().review).toEqual({
      tool: "unban-requests",
      items: [
        {
          kind: "unban",
          id: "appeal",
          userId: "30",
          name: "Viewer",
          text: "Please unban",
        },
      ],
      cursor: null,
    });
    await controller.execute({
      kind: "resolve-unban",
      requestId: "appeal",
      status: "approved",
      resolutionText: "Welcome back",
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://api.twitch.tv/helix/moderation/unban_requests?broadcaster_id=10&moderator_id=10&unban_request_id=appeal&status=approved&resolution_text=Welcome%20back",
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    expect(controller.getSnapshot().activity.kind).toBe("success");
    expect(controller.getSnapshot().review).toBeNull();
    controller.dispose();
  });
  it.each(["moderators", "vips"] as const)(
    "reads %s and changes membership only for the broadcaster",
    async (group) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            data: [{ user_id: "30", user_name: "Viewer" }],
            pagination: { cursor: "next" },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      const api = createModerationApi({ fetch });
      expect(
        await api.review(channel, group, null, credential, signal),
      ).toEqual({
        kind: "success",
        value: {
          tool: group,
          items: [{ kind: "member", userId: "30", name: "Viewer" }],
          cursor: "next",
        },
      });
      expect(
        await api.execute(
          channel,
          { kind: "membership", group, operation: "add", userId: "40" },
          credential,
          signal,
        ),
      ).toMatchObject({ kind: "success" });
      expect(fetch.mock.calls[1]?.[0]).toBe(
        `https://api.twitch.tv/helix/${group === "moderators" ? "moderation/moderators" : "channels/vips"}?broadcaster_id=10&user_id=40`,
      );
      expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
      expect(
        await api.execute(
          channel,
          { kind: "membership", group, operation: "remove", userId: "40" },
          credential,
          signal,
        ),
      ).toMatchObject({ kind: "success" });
      expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
      expect(
        await api.execute(
          { ...channel, id: "20" },
          { kind: "membership", group, operation: "add", userId: "40" },
          credential,
          signal,
        ),
      ).toMatchObject({ kind: "failure", reason: "unsupported" });
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );
  it("does not offer a manufactured Kick role or unban-request list", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [] }));
    const api = createModerationApi({ fetch });
    expect(
      await api.review(
        { ...channel, platform: "kick" },
        "unban-requests",
        null,
        { ...credential, platform: "kick" },
        signal,
      ),
    ).toMatchObject({ kind: "failure", reason: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
