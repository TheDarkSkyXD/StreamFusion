import { describe, expect, it } from "vitest";

import type { EffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/capabilities/installation-policy";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

import { createAdBlockSession } from "../composition/guest-adblock-session";
import {
  composeAdBlockView,
  DEFAULT_AD_BLOCK_PREFERENCES,
  parseAdBlockPreferences,
  playbackFilterRequest,
} from "../domain/adblock-policy";

function memorySettings(
  initial: Record<string, string> = {},
): ProductSettingsStore {
  const values = new Map(Object.entries(initial));
  return {
    async read(key) {
      return values.get(key) ?? null;
    },
    async write(key, value, _updatedAt) {
      values.set(key, value);
    },
  };
}

function policyReader(
  decision: Awaited<ReturnType<EffectiveCapabilityPolicyReader["read"]>>,
): EffectiveCapabilityPolicyReader {
  return {
    read: async () => decision,
  };
}

describe("adblock policy", () => {
  it("defaults guest filtering on with strip like desktop", () => {
    expect(DEFAULT_AD_BLOCK_PREFERENCES).toEqual({
      enabled: true,
      method: "strip",
    });
    expect(parseAdBlockPreferences(null)).toEqual({
      enabled: true,
      method: "strip",
    });
    expect(parseAdBlockPreferences("{}")).toEqual({
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
    expect(view.title).toBe("Twitch ads are filtered");
    expect(playbackFilterRequest("twitch", view)).toEqual({
      enabled: true,
      mode: "strip",
      platform: "twitch",
    });
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

  it("session effective() is strip for Twitch when prefs are unset", async () => {
    const session = createAdBlockSession({
      policy: policyReader({
        kind: "enabled",
        sequence: 1,
        verifiedAtEpochMs: 1,
      }),
      settings: memorySettings(),
    });
    await expect(session.effective("twitch")).resolves.toEqual({
      enabled: true,
      mode: "strip",
      platform: "twitch",
    });
    await expect(session.effective("kick")).resolves.toEqual({
      enabled: true,
      mode: "passthrough",
      platform: "kick",
    });
    const view = await session.load();
    expect(view.title).toBe("Twitch ads are filtered");
  });

  it("session treats no-valid-policy like desktop-compatible allow", async () => {
    const session = createAdBlockSession({
      policy: policyReader({
        kind: "disabled",
        reason: "no-valid-policy",
      }),
      settings: memorySettings(),
    });
    await expect(session.effective("twitch")).resolves.toMatchObject({
      enabled: true,
      mode: "strip",
    });
  });
});
