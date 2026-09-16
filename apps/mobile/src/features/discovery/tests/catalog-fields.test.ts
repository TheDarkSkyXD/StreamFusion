import { describe, expect, it } from "vitest";

import {
  gqlBroadcasterPartner,
  gqlBroadcasterVerified,
  gqlTags,
  helixTags,
  kickTags,
  kickVerified,
  twitchChannelVerified,
  twitchStreamVerified,
} from "../utils/catalog-fields";

// Guards: Helix/Kick/GQL tags and verified flags map from real payload fields only
describe("catalog field mapping", () => {
  it("reads Helix tags and treats affiliate or partner as verified", () => {
    expect(helixTags({ tags: ["English", { name: "IRL" }, ""] })).toEqual([
      "English",
      "IRL",
    ]);
    expect(twitchChannelVerified("")).toBe(false);
    expect(twitchChannelVerified("affiliate")).toBe(true);
    expect(twitchStreamVerified("affiliate")).toBe(false);
    expect(twitchStreamVerified("partner")).toBe(true);
  });

  it("prefers Kick custom_tags and user verified flags", () => {
    expect(
      kickTags({
        custom_tags: [{ tag: "English" }],
        tags: ["ignored"],
      }),
    ).toEqual(["English"]);
    expect(kickVerified({ user: { verified: true } })).toBe(true);
    expect(kickVerified({ user: { username: "absi" } })).toBe(false);
  });

  it("reads GQL freeform tags and broadcaster roles", () => {
    const broadcaster = {
      roles: { isAffiliate: true, isPartner: false },
    };
    expect(gqlTags({ freeformTags: [{ name: "Art" }] })).toEqual(["Art"]);
    expect(gqlBroadcasterVerified(broadcaster)).toBe(true);
    expect(gqlBroadcasterPartner(broadcaster)).toBe(false);
  });
});
