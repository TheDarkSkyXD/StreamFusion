import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureTwitchGlobalBadgeCatalog,
  resetTwitchGlobalBadgeCatalogForTests,
  resolveTwitchBadges,
} from "../domain/twitch-global-badge-catalog";
import { badgesIncludeTwitchModerator } from "../domain/twitch-moderator-badge";

describe("twitch global badge catalog", () => {
  afterEach(() => {
    resetTwitchGlobalBadgeCatalogForTests();
    vi.unstubAllGlobals();
  });

  it("caches lead_moderator artwork from the GQL Badges query", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          badges: [
            {
              imageURL: "https://static-cdn.jtvnw.net/badges/v1/lead-mod/3",
              setID: "lead_moderator",
              title: "Lead Moderator",
              version: "1",
            },
          ],
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await ensureTwitchGlobalBadgeCatalog(fetchMock as unknown as typeof fetch);
    const resolved = resolveTwitchBadges([
      { setId: "lead_moderator", version: "1" },
    ]);
    expect(resolved[0]).toEqual({
      setId: "lead_moderator",
      version: "1",
      imageUrl: "https://static-cdn.jtvnw.net/badges/v1/lead-mod/3",
      title: "Lead Moderator",
    });
    expect(badgesIncludeTwitchModerator(resolved)).toBe(true);
  });
});
