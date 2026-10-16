import { afterEach, describe, expect, it, vi } from "vitest";

import { isTwitchStreamEncrypted } from "@backend/features/playback/adapters/twitch/twitch-protected-stream-metadata";

describe("Twitch protected stream metadata", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [true, true],
    [false, false],
    [null, false],
  ])("uses Twitch's isEncrypted=%s value", async (value, expected) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ data: { user: { stream: { isEncrypted: value } } } }],
    });
    vi.stubGlobal("fetch", fetch);

    await expect(isTwitchStreamEncrypted("primevideo")).resolves.toBe(expected);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://gql.twitch.tv/gql");
    expect(JSON.parse(init.body)[0]).toMatchObject({
      variables: { login: "primevideo" },
    });
    expect(init.body).toContain("isEncrypted");
  });
});
