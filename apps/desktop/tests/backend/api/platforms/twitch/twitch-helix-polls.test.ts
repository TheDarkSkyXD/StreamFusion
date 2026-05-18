import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  archivePoll,
  createPoll,
  getPolls,
  terminatePoll,
} from "@/backend/api/platforms/twitch/twitch-helix-polls";

let lastUrl: string | null = null;
let lastMethod: string | null = null;
let lastBody: unknown = null;

interface NextResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let nextResponse: NextResponse = { status: 200, body: { data: [] } };

beforeEach(() => {
  lastUrl = null;
  lastMethod = null;
  lastBody = null;
  nextResponse = { status: 200, body: { data: [] } };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    lastUrl = url;
    lastMethod = (init?.method as string) ?? "GET";
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    const headers = new Headers(nextResponse.headers ?? {});
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      statusText: "",
      headers,
      json: async () => nextResponse.body ?? {},
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const POLL = {
  id: "poll1",
  broadcaster_id: "111",
  title: "Pick one",
  choices: [
    { id: "c1", title: "A", votes: 0, channel_points_votes: 0, bits_votes: 0 },
    { id: "c2", title: "B", votes: 0, channel_points_votes: 0, bits_votes: 0 },
  ],
  bits_voting_enabled: false,
  bits_per_vote: 0,
  channel_points_voting_enabled: false,
  channel_points_per_vote: 0,
  status: "ACTIVE",
  duration: 60,
  started_at: "2026-05-18T00:00:00Z",
  ended_at: null,
};

describe("twitch-helix-polls URL + method + body", () => {
  it("getPolls → GET /polls?broadcaster_id=…", async () => {
    nextResponse = { status: 200, body: { data: [POLL] } };
    await getPolls({ accessToken: "tok", broadcasterId: "111" });
    expect(lastMethod).toBe("GET");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/polls?broadcaster_id=111");
  });

  it("createPoll → POST /polls with required + optional fields", async () => {
    nextResponse = { status: 200, body: { data: [POLL] } };
    await createPoll({
      accessToken: "tok",
      broadcasterId: "111",
      title: "Pick one",
      choices: [{ title: "A" }, { title: "B" }],
      duration: 60,
      channelPointsVotingEnabled: true,
      channelPointsPerVote: 500,
    });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/polls");
    expect(lastBody).toEqual({
      broadcaster_id: "111",
      title: "Pick one",
      choices: [{ title: "A" }, { title: "B" }],
      duration: 60,
      channel_points_voting_enabled: true,
      channel_points_per_vote: 500,
    });
  });

  it("terminatePoll → PATCH /polls with body { broadcaster_id, id, status: 'TERMINATED' }", async () => {
    nextResponse = { status: 200, body: { data: [POLL] } };
    await terminatePoll({
      accessToken: "tok",
      broadcasterId: "111",
      pollId: "poll1",
    });
    expect(lastMethod).toBe("PATCH");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/polls");
    expect(lastBody).toEqual({
      broadcaster_id: "111",
      id: "poll1",
      status: "TERMINATED",
    });
  });

  it("archivePoll → PATCH /polls with status: 'ARCHIVED'", async () => {
    nextResponse = { status: 200, body: { data: [POLL] } };
    await archivePoll({
      accessToken: "tok",
      broadcasterId: "111",
      pollId: "poll1",
    });
    expect(lastBody).toEqual({
      broadcaster_id: "111",
      id: "poll1",
      status: "ARCHIVED",
    });
  });
});

describe("twitch-helix-polls validation", () => {
  it("createPoll throws synchronously when title is empty or > 60 chars", () => {
    expect(() =>
      createPoll({
        accessToken: "tok",
        broadcasterId: "111",
        title: "",
        choices: [{ title: "A" }, { title: "B" }],
        duration: 60,
      }),
    ).toThrow(/title/);
    expect(() =>
      createPoll({
        accessToken: "tok",
        broadcasterId: "111",
        title: "x".repeat(61),
        choices: [{ title: "A" }, { title: "B" }],
        duration: 60,
      }),
    ).toThrow(/title/);
  });

  it("createPoll throws on bad choice count / length and bad duration", () => {
    expect(() =>
      createPoll({
        accessToken: "tok",
        broadcasterId: "111",
        title: "ok",
        choices: [{ title: "A" }],
        duration: 60,
      }),
    ).toThrow(/choices/);
    expect(() =>
      createPoll({
        accessToken: "tok",
        broadcasterId: "111",
        title: "ok",
        choices: [{ title: "A" }, { title: "x".repeat(26) }],
        duration: 60,
      }),
    ).toThrow(/choice/);
    expect(() =>
      createPoll({
        accessToken: "tok",
        broadcasterId: "111",
        title: "ok",
        choices: [{ title: "A" }, { title: "B" }],
        duration: 5,
      }),
    ).toThrow(/duration/);
  });
});
