import { describe, expect, it } from "vitest";

import {
  composeAdBlockView,
  parseAdBlockPreferences,
  playbackFilterRequest,
} from "../domain/adblock-policy";

describe("adblock policy", () => {
  it("defaults guest filtering on with strip", () => {
    expect(parseAdBlockPreferences(null)).toEqual({
      enabled: true,
      method: "strip",
    });
  });

  it("discloses Kick as unsupported while Twitch can strip", () => {
    const view = composeAdBlockView({
      policyAllowed: true,
      preferences: { enabled: true, method: "strip" },
    });
    expect(view.kickSupported).toBe(false);
    expect(view.twitchSupported).toBe(true);
    expect(playbackFilterRequest("twitch", view).mode).toBe("strip");
    expect(playbackFilterRequest("kick", view).mode).toBe("passthrough");
  });

  it("turns the kill switch into passthrough", () => {
    const view = composeAdBlockView({
      policyAllowed: true,
      preferences: { enabled: false, method: "strip" },
    });
    expect(playbackFilterRequest("twitch", view).mode).toBe("passthrough");
  });

  it("keeps Watch playing when signed policy disables filtering", () => {
    const view = composeAdBlockView({
      policyAllowed: false,
      preferences: { enabled: true, method: "strip" },
    });
    expect(view.enabled).toBe(false);
    expect(view.detail).toContain("original stream");
    expect(playbackFilterRequest("twitch", view).mode).toBe("passthrough");
  });
});
