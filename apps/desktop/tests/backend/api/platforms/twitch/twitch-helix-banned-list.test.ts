import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BannedUsersFetchError,
  getBannedUsers,
} from "@/backend/api/platforms/twitch/twitch-helix-banned-list";

const BASE_ARGS = {
  accessToken: "tok",
  broadcasterId: "111",
  moderatorUserId: "222",
  clientId: "test-client-id",
};

function makeFetch(init: {
  status: number;
  body?: unknown;
  ok?: boolean;
  statusText?: string;
}): typeof fetch {
  return vi.fn(async () => ({
    ok: init.ok ?? (init.status >= 200 && init.status < 300),
    status: init.status,
    statusText: init.statusText ?? "",
    headers: new Headers(),
    json: async () => init.body ?? {},
  })) as unknown as typeof fetch;
}

const BANNED_USER = {
  user_id: "u1",
  user_login: "baduser",
  user_name: "BadUser",
  expires_at: "",
  created_at: "2026-01-01T00:00:00Z",
  reason: "spam",
  moderator_id: "222",
  moderator_login: "mod",
  moderator_name: "Mod",
};

describe("getBannedUsers", () => {
  it("returns data and cursor on success", async () => {
    const result = await getBannedUsers({
      ...BASE_ARGS,
      fetchImpl: makeFetch({
        status: 200,
        body: { data: [BANNED_USER], pagination: { cursor: "abc" } },
      }),
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].user_id).toBe("u1");
    expect(result.cursor).toBe("abc");
  });

  it("returns null cursor when pagination is absent", async () => {
    const result = await getBannedUsers({
      ...BASE_ARGS,
      fetchImpl: makeFetch({ status: 200, body: { data: [BANNED_USER] } }),
    });

    expect(result.cursor).toBeNull();
  });

  it("returns empty data when body has no data array", async () => {
    const result = await getBannedUsers({
      ...BASE_ARGS,
      fetchImpl: makeFetch({ status: 200, body: {} }),
    });

    expect(result.data).toEqual([]);
    expect(result.cursor).toBeNull();
  });

  it("sends correct URL with broadcaster_id and first params", async () => {
    const spy = makeFetch({ status: 200, body: { data: [] } });
    await getBannedUsers({ ...BASE_ARGS, first: 50, fetchImpl: spy });

    const call = (spy as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain("broadcaster_id=111");
    expect(url).toContain("first=50");
    expect(url).toContain("/moderation/banned");
  });

  it("includes cursor as 'after' param", async () => {
    const spy = makeFetch({ status: 200, body: { data: [] } });
    await getBannedUsers({ ...BASE_ARGS, cursor: "xyz", fetchImpl: spy });

    const call = (spy as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain("after=xyz");
  });

  it("clamps first to 1..100 range", async () => {
    const spy = makeFetch({ status: 200, body: { data: [] } });

    await getBannedUsers({ ...BASE_ARGS, first: 0, fetchImpl: spy });
    let url = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("first=1");

    await getBannedUsers({ ...BASE_ARGS, first: 200, fetchImpl: spy });
    url = (spy as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(url).toContain("first=100");
  });

  it("sends Authorization and Client-Id headers", async () => {
    const spy = makeFetch({ status: 200, body: { data: [] } });
    await getBannedUsers({ ...BASE_ARGS, fetchImpl: spy });

    const call = (spy as ReturnType<typeof vi.fn>).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Client-Id"]).toBe("test-client-id");
  });

  it("throws BannedUsersFetchError with kind=unauthorized on 401", async () => {
    await expect(
      getBannedUsers({
        ...BASE_ARGS,
        fetchImpl: makeFetch({ status: 401 }),
      })
    ).rejects.toThrow(BannedUsersFetchError);

    try {
      await getBannedUsers({ ...BASE_ARGS, fetchImpl: makeFetch({ status: 401 }) });
    } catch (e) {
      expect((e as BannedUsersFetchError).info.kind).toBe("unauthorized");
    }
  });

  it("throws BannedUsersFetchError with kind=forbidden on 403", async () => {
    try {
      await getBannedUsers({ ...BASE_ARGS, fetchImpl: makeFetch({ status: 403 }) });
    } catch (e) {
      expect((e as BannedUsersFetchError).info.kind).toBe("forbidden");
    }
  });

  it("throws BannedUsersFetchError with kind=not-found on 404", async () => {
    try {
      await getBannedUsers({ ...BASE_ARGS, fetchImpl: makeFetch({ status: 404 }) });
    } catch (e) {
      expect((e as BannedUsersFetchError).info.kind).toBe("not-found");
    }
  });

  it("throws BannedUsersFetchError with kind=rate-limited on 429", async () => {
    try {
      await getBannedUsers({ ...BASE_ARGS, fetchImpl: makeFetch({ status: 429 }) });
    } catch (e) {
      expect((e as BannedUsersFetchError).info.kind).toBe("rate-limited");
    }
  });

  it("throws BannedUsersFetchError with kind=network on other non-ok status", async () => {
    try {
      await getBannedUsers({
        ...BASE_ARGS,
        fetchImpl: makeFetch({ status: 500, ok: false, statusText: "Internal Server Error" }),
      });
    } catch (e) {
      const err = e as BannedUsersFetchError;
      expect(err.info.kind).toBe("network");
      expect((err.info as { message: string }).message).toContain("500");
    }
  });

  it("throws BannedUsersFetchError with kind=network on fetch failure", async () => {
    const failFetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    try {
      await getBannedUsers({ ...BASE_ARGS, fetchImpl: failFetch });
    } catch (e) {
      const err = e as BannedUsersFetchError;
      expect(err.info.kind).toBe("network");
      expect((err.info as { message: string }).message).toContain("fetch failed");
    }
  });

  it("handles malformed JSON body gracefully", async () => {
    const badJsonFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "",
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    })) as unknown as typeof fetch;

    const result = await getBannedUsers({ ...BASE_ARGS, fetchImpl: badJsonFetch });
    expect(result.data).toEqual([]);
    expect(result.cursor).toBeNull();
  });
});
