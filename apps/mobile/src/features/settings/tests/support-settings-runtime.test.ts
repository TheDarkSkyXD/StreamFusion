import { describe, expect, it } from "vitest";

import { createSupportSettingsSession } from "../composition/support-settings-runtime";
import { DEFAULT_SUPPORT_SETTINGS } from "../domain/support-settings";
import type { SupportSettings } from "../capabilities/support-settings";

function memoryStore(initial: SupportSettings = DEFAULT_SUPPORT_SETTINGS) {
  let value = initial;
  return {
    read: async () => value,
    write: async (next: unknown) => {
      value = next as SupportSettings;
      return value;
    },
  };
}

function session(overrides?: {
  readonly connected?: boolean;
  readonly historyCount?: number;
}) {
  const historyRows = Array.from({ length: overrides?.historyCount ?? 2 }, (_, i) => i);
  return createSupportSettingsSession({
    logs: {
      list: () => [
        { level: "info", message: "opened", source: "storage" },
        { level: "debug", message: "hidden", source: "player" },
      ],
    },
    maintenance: {
      clearHistory: async () => `Cleared ${historyRows.length} History rows.`,
      disconnectAccounts: async () =>
        overrides?.connected
          ? "Connected-account disconnect waits for the OAuth tickets."
          : "No connected account. Guest Follows stay. OAuth is not started.",
      removeCompletedMedia: async () =>
        "No completed, canceled, or failed app-private jobs to remove.",
      resetApp: async () => "Reset product Settings.",
    },
    metadata: { read: () => ({ name: "StreamFusion", runtimeHost: "development-client", version: "1.0.0-beta.1" }) },
    releases: {
      check: async () => ({
        copy: "Stable v1.2.0 is published. APK download waits.",
        network: "online",
      }),
    },
    share: {
      share: async () => "Android share opened for the redacted local report.",
    },
    store: memoryStore(),
  });
}

// Guards: Check now persists GitHub copy; destructive actions require confirm; guest disconnect does not start OAuth
describe("support settings runtime", () => {
  it("persists a GitHub check result", async () => {
    const settings = session();
    await settings.load();
    const checked = await settings.checkForUpdates();
    expect(checked.updateCopy).toMatch(/Stable v1.2.0/);
    expect(checked.preferences.lastCheckCopy).toMatch(/Stable v1.2.0/);
  });

  it("keeps History until confirm and reports guest disconnect without OAuth", async () => {
    const settings = session();
    await settings.load();
    const pending = await settings.requestMaintenance("clear-history");
    expect(pending.pending).toBe("clear-history");
    const canceled = await settings.cancelMaintenance();
    expect(canceled.pending).toBeNull();
    expect(canceled.resultCopy).toMatch(/Canceled/);
    await settings.requestMaintenance("disconnect-accounts");
    const disconnected = await settings.confirmMaintenance();
    expect(disconnected.resultCopy).toMatch(/No connected account/);
  });

  it("builds then shares a local report", async () => {
    const settings = session();
    await settings.load();
    const built = await settings.buildReport();
    expect(built.preferences.lastReport).toMatch(/"redacted":true/);
    const shared = await settings.shareReport();
    expect(shared.resultCopy).toMatch(/share opened/);
  });
});
