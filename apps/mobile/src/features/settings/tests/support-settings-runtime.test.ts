import { describe, expect, it } from "vitest";

import { createSupportSettingsSession } from "../composition/support-settings-runtime";
import { DEFAULT_SUPPORT_SETTINGS } from "../domain/support-settings";
import type { AndroidUpdaterPort, UpdateSnapshot } from "@mobile/features/app-update/capabilities/android-updater";
import type {
  SupportReleaseCheckPort,
  SupportReleaseOpenPort,
  SupportSettings,
  SupportSettingsStore,
} from "../capabilities/support-settings";

const AVAILABLE_RELEASE = {
  version: "1.2.0",
  tag: "android-v1.2.0",
  notes: "New player controls.",
  releaseUrl: "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v1.2.0",
  apkBytes: 1024,
  apkSha256: "a".repeat(64),
};

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
  readonly releases?: SupportReleaseCheckPort;
  readonly open?: SupportReleaseOpenPort;
  readonly store?: SupportSettingsStore;
  readonly updater?: AndroidUpdaterPort;
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
    releases: overrides?.releases ?? {
      check: async () => ({ status: "available" as const, release: AVAILABLE_RELEASE }),
    },
    open: overrides?.open ?? { open: async () => {} },
    share: {
      share: async () => "Android share opened for the redacted local report.",
    },
    store: overrides?.store ?? memoryStore(),
    updater: overrides?.updater ?? {
      snapshot: async () => ({ revision: 0, phase: { kind: "idle" } }),
      command: async () => ({ revision: 0, phase: { kind: "idle" } }),
      subscribe: () => () => {},
    },
  });
}

// Guards: Check now persists GitHub copy; destructive actions require confirm; guest disconnect does not start OAuth
describe("support settings runtime", () => {
  it("downloads in app, hides active progress, and restores it from native state", async () => {
    let snapshot: UpdateSnapshot = { revision: 0, phase: { kind: "idle" } };
    const commands: string[] = [];
    const updater: AndroidUpdaterPort = {
      snapshot: async () => snapshot,
      subscribe: () => () => {},
      command: async (command) => {
        commands.push(command.kind);
        if (command.kind !== "download") throw new Error("unexpected command");
        snapshot = {
          revision: 1,
          phase: {
            kind: "downloading",
            operation: "operation-1",
            release: command.release,
            bytes: 512,
            total: command.release.apkBytes,
          },
        };
        return snapshot;
      },
    };
    const settings = session({ updater });
    await settings.checkOnLaunch();
    expect(settings.peek().updatePopupVisible).toBe(true);
    await settings.downloadUpdate();
    expect(commands).toEqual(["download"]);
    expect(settings.peek().updater).toMatchObject({ kind: "downloading", bytes: 512 });
    await settings.hideUpdate();
    expect(settings.peek().updatePopupVisible).toBe(false);
    expect(settings.peek().updater.kind).toBe("downloading");

    const restored = session({ updater });
    await restored.load();
    expect(restored.peek().updatePopupVisible).toBe(true);
    expect(restored.peek().updater).toMatchObject({ kind: "downloading", bytes: 512 });
  });

  it("postpones one offer until tomorrow while allowing explicit reopen", async () => {
    const store = memoryStore();
    const settings = session({ store });
    await settings.checkOnLaunch();
    await settings.laterUpdate();
    expect(settings.peek().updatePopupVisible).toBe(false);
    expect((await store.read()).postponedUpdate?.tag).toBe(AVAILABLE_RELEASE.tag);
    await settings.checkForUpdates();
    expect(settings.peek().updatePopupVisible).toBe(false);
    settings.openUpdate();
    expect(settings.peek().updatePopupVisible).toBe(true);
  });

  it("closes before Android handoff and does not reopen on duplicate, older, or release snapshots", async () => {
    const operation = "operation-handoff";
    let current: UpdateSnapshot = { revision: 1, phase: { kind: "downloading", operation, release: AVAILABLE_RELEASE, bytes: 250, total: 1024 } };
    const updater: AndroidUpdaterPort = {
      snapshot: async () => current,
      command: async () => { throw new Error("unexpected command"); },
      subscribe: () => () => {},
    };
    const settings = session({ updater });
    await settings.checkOnLaunch();
    expect(settings.peek().updatePopupVisible).toBe(true);
    current = { revision: 2, phase: { kind: "verifying", operation, release: AVAILABLE_RELEASE } };
    await settings.load();
    expect(settings.peek().updatePopupVisible).toBe(true);
    current = { revision: 3, phase: { kind: "ready", operation, release: AVAILABLE_RELEASE } };
    await settings.load();
    expect(settings.peek().updatePopupVisible).toBe(false);
    settings.openUpdate();
    expect(settings.peek().updatePopupVisible).toBe(false);
    for (const kind of ["staging", "awaiting-approval"] as const) {
      current = { revision: current.revision + 1, phase: { kind, operation, release: AVAILABLE_RELEASE } };
      await settings.load();
      expect(settings.peek().updatePopupVisible).toBe(false);
    }
    await settings.checkForUpdates();
    expect(settings.peek().updatePopupVisible).toBe(false);
    await settings.load();
    expect(settings.peek().updatePopupVisible).toBe(false);
    current = { revision: 2, phase: { kind: "downloading", operation, release: AVAILABLE_RELEASE, bytes: 500, total: 1024 } };
    await settings.load();
    expect(settings.peek().updater.kind).toBe("awaiting-approval");
    expect(settings.peek().updatePopupVisible).toBe(false);
  });

  it("rehydrates Android recovery without a modal and reuses the retained operation", async () => {
    const operation = "operation-restart";
    for (const kind of ["ready", "permission-needed", "staging", "awaiting-approval"] as const) {
      const commands: unknown[] = [];
      const updater: AndroidUpdaterPort = {
        snapshot: async () => ({ revision: 8, phase: { kind, operation, release: AVAILABLE_RELEASE } }),
        command: async (command) => {
          commands.push(command);
          return { revision: 8, phase: { kind, operation, release: AVAILABLE_RELEASE } };
        },
        subscribe: () => () => {},
      };
      const settings = session({ updater });
      await settings.checkOnLaunch();
      settings.openUpdate();
      expect(settings.peek().updatePopupVisible).toBe(false);
      if (kind !== "staging") {
        await settings.installUpdate();
        expect(commands).toEqual([{ kind: "install", operation }]);
      }
    }
  });

  it("shows installation success once across app relaunches", async () => {
    const operation = "11111111-1111-4111-8111-111111111111";
    const store = memoryStore();
    const updater: AndroidUpdaterPort = {
      snapshot: async () => ({
        revision: 4,
        phase: {
          kind: "installed",
          operation,
          release: AVAILABLE_RELEASE,
        },
      }),
      command: async () => { throw new Error("no action"); },
      subscribe: () => () => {},
    };
    const first = session({ store, updater });
    await first.load();
    expect(first.peek().updatePopupVisible).toBe(true);
    await first.hideUpdate();
    const restarted = session({ store, updater });
    await restarted.load();
    expect(restarted.peek().updater.kind).toBe("installed");
    expect(restarted.peek().updatePopupVisible).toBe(false);
  });

  it("persists a GitHub check result", async () => {
    const settings = session();
    await settings.load();
    const checked = await settings.checkForUpdates();
    expect(checked.update).toMatchObject({ status: "available", release: { version: "1.2.0" } });
    expect(checked.preferences.lastCheckCopy).toBe("Android 1.2.0 is available.");
  });

  it("checks once on launch even when return-to-app checks are off", async () => {
    let calls = 0;
    const settings = session({
      releases: { check: async () => {
        calls += 1;
        return { status: "available", release: AVAILABLE_RELEASE };
      } },
    });
    await Promise.all([settings.checkOnLaunch(), settings.checkOnLaunch()]);
    expect(settings.peek().update.status).toBe("available");
    expect(calls).toBe(1);
    await settings.checkOnForeground();
    expect(calls).toBe(1);
  });

  it("rechecks with the new prerelease preference and keeps unrelated writes", async () => {
    const seen: boolean[] = [];
    const store = memoryStore();
    const settings = session({
      store,
      releases: { check: async ({ allowPrerelease }) => {
        seen.push(allowPrerelease);
        return allowPrerelease
          ? { status: "available", release: AVAILABLE_RELEASE }
          : { status: "current", release: null };
      } },
    });
    await settings.checkOnLaunch();
    await Promise.all([
      settings.apply({ allowPrerelease: false }),
      settings.apply({ reportDescription: "player stalled" }),
    ]);
    expect(seen).toEqual([true, false]);
    expect((await store.read()).allowPrerelease).toBe(false);
    expect((await store.read()).reportDescription).toBe("player stalled");
    expect(settings.peek().update.status).toBe("current");
  });

  it("coalesces busy checks and finishes on a newly selected release channel", async () => {
    let started!: () => void;
    let finish!: (value: { status: "available"; release: typeof AVAILABLE_RELEASE }) => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    const firstResult = new Promise<{ status: "available"; release: typeof AVAILABLE_RELEASE }>((resolve) => {
      finish = resolve;
    });
    const channels: boolean[] = [];
    const settings = session({
      releases: { check: async ({ allowPrerelease }) => {
        channels.push(allowPrerelease);
        if (channels.length === 1) {
          started();
          return firstResult;
        }
        return { status: "current", release: null };
      } },
    });
    const launched = settings.checkOnLaunch();
    await requestStarted;
    const manual = settings.checkForUpdates();
    const toggle = settings.apply({ allowPrerelease: false });
    expect(settings.peek().update.status).toBe("checking");
    finish({ status: "available", release: AVAILABLE_RELEASE });
    await Promise.all([launched, manual, toggle]);
    expect(channels).toEqual([true, false]);
    expect(settings.peek().update.status).toBe("current");
    expect(settings.peek().preferences.allowPrerelease).toBe(false);
  });

  it("keeps an available update when browser open fails, then retries without refetching", async () => {
    let checks = 0;
    let opens = 0;
    const settings = session({
      releases: { check: async () => {
        checks += 1;
        return { status: "available", release: AVAILABLE_RELEASE };
      } },
      open: { open: async (url) => {
        expect(url).toBe(AVAILABLE_RELEASE.releaseUrl);
        opens += 1;
        if (opens === 1) throw new Error("no browser");
      } },
    });
    await settings.checkOnLaunch();
    await settings.openRelease();
    expect(settings.peek().update.status).toBe("available");
    expect(settings.peek().releaseOpenError).toBe("Could not open the release in your browser. Try again.");
    await settings.openRelease();
    expect(settings.peek().releaseOpenError).toBeNull();
    expect(checks).toBe(1);
    expect(opens).toBe(2);
  });

  it("shows a check error when the release adapter rejects", async () => {
    const settings = session({
      releases: { check: async () => { throw new Error("network failed"); } },
    });
    await settings.checkOnLaunch();
    expect(settings.peek().update).toEqual({
      status: "error",
      message: "Update check could not finish. Try again.",
    });
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
