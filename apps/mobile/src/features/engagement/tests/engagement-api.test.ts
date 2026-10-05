import { describe, expect, it, vi } from "vitest";
import type {
  ModerationChannel,
  ProviderCredential,
} from "@mobile/features/moderation/capabilities/moderation";
import { createEngagementApi } from "../adapters/engagement-api";
import type { EngagementCommand } from "../capabilities/engagement";

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
const poll = {
  id: "poll",
  title: "Next game?",
  status: "ACTIVE",
  choices: [
    { id: "a", title: "Chess", votes: 12 },
    { id: "b", title: "Go", votes: 8 },
  ],
};
const prediction = {
  id: "prediction",
  title: "Win?",
  status: "ACTIVE",
  winning_outcome_id: null,
  outcomes: [
    { id: "yes", title: "Yes", users: 12 },
    { id: "no", title: "No", users: 8 },
  ],
};
describe("official broadcaster polls and predictions", () => {
  it("reads provider polls and predictions and exposes result counts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [poll] }))
      .mockResolvedValueOnce(Response.json({ data: [prediction] }));
    const api = createEngagementApi({ fetch });
    expect(await api.polls(channel, credential, signal)).toEqual({
      kind: "success",
      value: [poll],
    });
    expect(await api.predictions(channel, credential, signal)).toEqual({
      kind: "success",
      value: [
        {
          id: "prediction",
          title: "Win?",
          status: "ACTIVE",
          winningOutcomeId: null,
          outcomes: [
            { id: "yes", title: "Yes", votes: 12 },
            { id: "no", title: "No", votes: 8 },
          ],
        },
      ],
    });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "https://api.twitch.tv/helix/polls?broadcaster_id=10&first=20",
      "https://api.twitch.tv/helix/predictions?broadcaster_id=10&first=20",
    ]);
  });
  it.each([
    [
      {
        kind: "create-poll",
        title: "Next?",
        choices: ["Chess", "Go"],
        durationSeconds: 120,
      },
      "POST",
      "polls",
      {
        broadcaster_id: "10",
        title: "Next?",
        choices: [{ title: "Chess" }, { title: "Go" }],
        duration: 120,
        channel_points_voting_enabled: false,
      },
    ],
    [
      { kind: "end-poll", id: "poll", archive: false },
      "PATCH",
      "polls",
      { broadcaster_id: "10", id: "poll", status: "TERMINATED" },
    ],
    [
      { kind: "end-poll", id: "poll", archive: true },
      "PATCH",
      "polls",
      { broadcaster_id: "10", id: "poll", status: "ARCHIVED" },
    ],
    [
      {
        kind: "create-prediction",
        title: "Win?",
        outcomes: ["Yes", "No"],
        durationSeconds: 120,
      },
      "POST",
      "predictions",
      {
        broadcaster_id: "10",
        title: "Win?",
        outcomes: [{ title: "Yes" }, { title: "No" }],
        prediction_window: 120,
      },
    ],
    [
      { kind: "lock-prediction", id: "prediction" },
      "PATCH",
      "predictions",
      { broadcaster_id: "10", id: "prediction", status: "LOCKED" },
    ],
    [
      { kind: "cancel-prediction", id: "prediction" },
      "PATCH",
      "predictions",
      { broadcaster_id: "10", id: "prediction", status: "CANCELED" },
    ],
    [
      { kind: "resolve-prediction", id: "prediction", winningOutcomeId: "yes" },
      "PATCH",
      "predictions",
      {
        broadcaster_id: "10",
        id: "prediction",
        status: "RESOLVED",
        winning_outcome_id: "yes",
      },
    ],
  ] satisfies readonly (readonly [
    EngagementCommand,
    string,
    string,
    unknown,
  ])[])(
    "sends %j with official request semantics",
    async (command, method, endpoint, body) => {
      const fetch = vi.fn(async () =>
        Response.json({ data: [endpoint === "polls" ? poll : prediction] }),
      );
      const result = await createEngagementApi({ fetch }).execute(
        channel,
        command,
        credential,
        signal,
      );
      expect(result).toMatchObject({
        kind: "success",
        value: { kind: endpoint === "polls" ? "poll" : "prediction" },
      });
      expect(fetch.mock.calls[0]?.[0]).toBe(
        `https://api.twitch.tv/helix/${endpoint}`,
      );
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        method,
        headers: {
          Authorization: "Bearer token",
          "Client-Id": "client",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    },
  );
  it("hands off viewer and Kick engagement without requesting another account's resources", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [poll] }));
    const api = createEngagementApi({ fetch });
    expect(
      await api.polls({ ...channel, id: "20" }, credential, signal),
    ).toMatchObject({ kind: "failure", reason: "unsupported" });
    expect(
      await api.predictions(
        { ...channel, platform: "kick" },
        { ...credential, platform: "kick" },
        signal,
      ),
    ).toMatchObject({ kind: "failure", reason: "unsupported" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await api.polls(channel, credential, signal)).toMatchObject({
      kind: "success",
      value: [poll],
    });
  });
  it.each([
    [401, "auth"],
    [403, "permission"],
    [429, "rate-limit"],
  ])(
    "reports provider denial %s without manufacturing a poll",
    async (status, reason) => {
      const fetch = vi.fn(
        async () => new Response("", { status: Number(status) }),
      );
      expect(
        await createEngagementApi({ fetch }).execute(
          channel,
          {
            kind: "create-poll",
            title: "Next?",
            choices: ["Chess", "Go"],
            durationSeconds: 120,
          },
          credential,
          signal,
        ),
      ).toMatchObject({ kind: "failure", reason });
    },
  );
  it("does not confirm malformed or interrupted provider results", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "poll", status: "ACTIVE" }] }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const api = createEngagementApi({ fetch });
    const command: EngagementCommand = {
      kind: "create-poll",
      title: "Next?",
      choices: ["Chess", "Go"],
      durationSeconds: 120,
    };
    expect(
      await api.execute(channel, command, credential, signal),
    ).toMatchObject({ kind: "failure", reason: "provider" });
    expect(
      await api.execute(channel, command, credential, signal),
    ).toMatchObject({
      kind: "failure",
      reason: "network",
      detail: expect.stringContaining("may have applied"),
    });
  });
});
