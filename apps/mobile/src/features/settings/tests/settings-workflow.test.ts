import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PRODUCT_PREFERENCES } from "@streamfusion/core/settings";

import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import { createSettingsSession } from "../composition/settings-runtime";
import { playbackSessionPolicy } from "../domain/settings-view";
import { activateDisplayLanguage, i18n } from "@mobile/i18n";

vi.mock("../adapters/appearance-scheme", () => ({
  applyAppearanceScheme: vi.fn(),
}));

vi.mock("@mobile/i18n", async () => {
  const actual = await vi.importActual<typeof import("@mobile/i18n")>("@mobile/i18n");
  return {
    ...actual,
    activateDisplayLanguage: vi.fn(actual.activateDisplayLanguage),
  };
});

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

describe("settings workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads defaults and rejects a light theme patch", async () => {
    const settings = session();
    const loaded = await settings.load();
    expect(loaded.preferences.theme).toBe("dark");
    const applied = await settings.apply({ theme: "light" });
    expect(applied.preferences.theme).toBe("dark");
    expect(applied.rejected[0]).toMatch(/Dark mode/);
    expect(settings.snapshot().theme).toBe("dark");
  });

  it("persists a supported display language and activates i18n", async () => {
    const settings = session();
    await settings.load();
    const applied = await settings.apply({ language: "fr", quality: "720p" });
    expect(applied.preferences.language).toBe("fr");
    expect(applied.preferences.quality).toBe("720p");
    expect(applied.rejected).toEqual([]);
    expect(settings.snapshot().language).toBe("fr");
    expect(activateDisplayLanguage).toHaveBeenCalledWith("fr");
    await activateDisplayLanguage("fr");
    expect(i18n.resolvedLanguage ?? i18n.language).toBe("fr");
    expect(i18n.t("navigation.settings")).toBe("Paramètres");
  });

  it("rejects unsupported locales without overwriting the saved language", async () => {
    const settings = session();
    await settings.load();
    await settings.apply({ language: "es" });
    const applied = await settings.apply({ language: "klingon" });
    expect(applied.preferences.language).toBe("es");
    expect(applied.rejected[0]).toMatch(/Unsupported display language/);
  });

  it("keeps Notifications, Ad blocking, Proxy, and Updates in local search", async () => {
    const settings = session();
    await settings.load();
    const proxy = await settings.search("proxy");
    expect(proxy.panels).toEqual(["proxy"]);
    const alerts = await settings.search("alerts");
    expect(alerts.panels).toEqual(["notifications"]);
    const ads = await settings.search("adblock");
    expect(ads.panels).toEqual(["adblock"]);
    const updates = await settings.search("github");
    expect(updates.panels).toEqual(["updates"]);
    const bug = await settings.search("bug");
    expect(bug.panels).toEqual(["report-bug"]);
  });

  it("clears a stale lang hub filter so every category returns", async () => {
    const settings = session();
    await settings.load();
    const filtered = await settings.search("lang");
    expect(filtered.query).toBe("lang");
    expect(filtered.panels).toContain("appearance");
    expect(filtered.matches.some((match) => match.id === "language")).toBe(true);
    expect(filtered.panels.includes("proxy")).toBe(false);

    const cleared = await settings.search("");
    expect(cleared.query).toBe("");
    expect(cleared.panels).toEqual(
      expect.arrayContaining([
        "appearance",
        "playback",
        "chat",
        "adblock",
        "proxy",
        "notifications",
      ]),
    );
    expect(cleared.panels.length).toBeGreaterThan(8);
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
