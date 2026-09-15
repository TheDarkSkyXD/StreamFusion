import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";

import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import { createSettingsSession } from "../composition/settings-runtime";
import { playbackSessionPolicy } from "../domain/settings-view";

vi.mock("../adapters/appearance-scheme", () => ({
  applyAppearanceScheme: vi.fn(),
}));

function memorySettings(): ProductSettingsStore {
  const values = new Map<string, string>();
  return {
    read: async (key) => values.get(key) ?? null,
    write: async (key, value, _updatedAt) => {
      values.set(key, value);
    },
  };
}

function session() {
  return createSettingsSession({ settings: memorySettings() });
}

// Guards: Settings stay dark-only, reject unsupported locales, and map buffer/HEVC into Watch policy
describe("settings workflow", () => {
  it("loads defaults and rejects a light theme patch", async () => {
    const settings = session();
    const loaded = await settings.load();
    expect(loaded.preferences.theme).toBe("dark");
    const applied = await settings.apply({ theme: "light" });
    expect(applied.preferences.theme).toBe("dark");
    expect(applied.rejected[0]).toMatch(/Dark mode/);
    expect(settings.snapshot().theme).toBe("dark");
  });

  it("keeps English when another locale is requested", async () => {
    const settings = session();
    await settings.load();
    const applied = await settings.apply({ language: "fr", quality: "720p" });
    expect(applied.preferences.language).toBe("en");
    expect(applied.preferences.quality).toBe("720p");
    expect(applied.rejected[0]).toMatch(/English/);
  });

  it("maps playback policy for Watch and Multistream", () => {
    const policy = playbackSessionPolicy({
      ...DEFAULT_PRODUCT_PREFERENCES,
      allowHevc: false,
      backgroundQuality: "160p",
      captionsEnabled: false,
      quality: "720p",
    });
    expect(policy).toMatchObject({
      allowHevc: false,
      backgroundQuality: "160p",
      captionsEnabled: false,
      quality: "720p",
    });
  });
});
