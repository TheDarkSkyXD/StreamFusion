import { describe, expect, it } from "vitest";

import {
  CLIP_TIME_SETTING_KEY,
  LANGUAGE_SETTING_KEY,
} from "../capabilities/discovery-preferences";
import { createDiscoveryPreferenceStore } from "../data/discovery-preference-store";

describe("discovery preference store", () => {
  it("persists language and clip time on the Product settings keys", async () => {
    const rows = new Map<string, string>();
    const store = createDiscoveryPreferenceStore({
      now: () => 1_700,
      readSetting: async (key) => rows.get(key) ?? null,
      writeSetting: async ({ key, value }) => {
        rows.set(key, value);
      },
    });
    await store.writeLanguage("ja");
    await store.writeClipTimeRange("week");
    expect(rows.get(LANGUAGE_SETTING_KEY)).toBe("ja");
    expect(rows.get(CLIP_TIME_SETTING_KEY)).toBe("week");
    expect(await store.readLanguage()).toBe("ja");
    expect(await store.readClipTimeRange()).toBe("week");
  });

  it("defaults unknown clip windows to all", async () => {
    const store = createDiscoveryPreferenceStore({
      readSetting: async () => "decade",
      writeSetting: async () => undefined,
    });
    expect(await store.readClipTimeRange()).toBe("all");
  });
});
