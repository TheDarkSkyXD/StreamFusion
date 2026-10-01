import type { AppMetadataReader } from "@mobile/features/diagnostics/capabilities/app-metadata";
import { redactDiagnosticExport } from "@mobile/features/diagnostics/domain/diagnostics-workspace";

import type {
  SupportLogPort,
  SupportMaintenanceKind,
  SupportMaintenancePort,
  SupportPreferencePatch,
  SupportReleaseCheckPort,
  SupportReleaseOpenPort,
  SupportSettingsSession,
  SupportSettingsStore,
  SupportSettingsView,
  SupportSharePort,
  UpdateCheckState,
} from "../capabilities/support-settings";
import {
  buildLocalReport,
  composeSupportSettingsView,
  defaultSupportSettingsView,
  mergeSupportSettings,
  updateStatusCopy,
} from "../domain/support-settings";

function redactedLocalReport(input: {
  readonly installedVersion: string;
  readonly logs: ReturnType<SupportLogPort["list"]>;
  readonly preferences: SupportSettingsView["preferences"];
}): string {
  return redactDiagnosticExport(
    buildLocalReport({
      installedVersion: input.installedVersion,
      logs: input.logs,
      preferences: input.preferences,
      profileCopy: "Capability Profile omitted secrets and FCM tokens.",
    }),
  );
}

export function createSupportSettingsSession(input: {
  readonly logs: SupportLogPort;
  readonly maintenance: SupportMaintenancePort;
  readonly metadata: AppMetadataReader;
  readonly releases: SupportReleaseCheckPort;
  readonly open: SupportReleaseOpenPort;
  readonly share: SupportSharePort;
  readonly store: SupportSettingsStore;
}): SupportSettingsSession {
  const listeners = new Set<() => void>();
  let cached = defaultSupportSettingsView(input.metadata.read().version);
  let pending: SupportMaintenanceKind | null = null;
  let resultCopy = "";
  let update: UpdateCheckState = { status: "idle" };
  let releaseOpenError: string | null = null;
  let checkPromise: Promise<SupportSettingsView> | null = null;
  let launched = false;
  let writes: Promise<void> = Promise.resolve();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function hydrate(): Promise<SupportSettingsView> {
    const preferences = await input.store.read();
    cached = composeSupportSettingsView({
      installedVersion: input.metadata.read().version,
      logs: input.logs.list(),
      pending,
      preferences,
      resultCopy,
      releaseOpenError,
      update,
    });
    notify();
    return cached;
  }

  async function persist(patch: SupportPreferencePatch): Promise<SupportSettingsView> {
    const next = writes.then(async () => {
      const current = await input.store.read();
      await input.store.write(mergeSupportSettings(current, patch));
    });
    writes = next.catch(() => {});
    await next;
    return hydrate();
  }

  function setUpdate(next: UpdateCheckState): void {
    update = next;
    releaseOpenError = null;
    cached = {
      ...cached,
      update,
      updateCopy: updateStatusCopy(update, cached.installedVersion, cached.preferences.lastCheckCopy),
      releaseOpenError,
    };
    notify();
  }

  function checkForUpdates(): Promise<SupportSettingsView> {
    if (checkPromise) return checkPromise;
    setUpdate({ status: "checking" });
    const running = (async () => {
      try {
        const checked = await input.releases.check({
          installedVersion: cached.installedVersion,
          allowPrerelease: cached.preferences.allowPrerelease,
        });
        setUpdate(checked);
        const copy = checked.status === "error"
          ? checked.message
          : checked.status === "available"
            ? `Android ${checked.release.version} is available.`
          : checked.release
            ? `Installed ${cached.installedVersion} is up to date.`
            : "No stable Android release has been published yet.";
        resultCopy = copy;
        return await persist(checked.status === "error"
          ? { lastCheckCopy: copy }
          : { lastCheckAt: Date.now(), lastCheckCopy: copy });
      } catch {
        setUpdate({ status: "error", message: "Update check could not finish. Try again." });
        return cached;
      }
    })().finally(() => {
      checkPromise = null;
    });
    checkPromise = running;
    return running;
  }

  async function openRelease(kind: "apkUrl" | "releaseUrl"): Promise<void> {
    if (update.status !== "available" && update.status !== "current") return;
    if (!update.release || (kind === "apkUrl" && update.status !== "available")) return;
    try {
      await input.open.open(update.release[kind]);
      releaseOpenError = null;
    } catch {
      releaseOpenError = "Could not open the release in your browser. Try again.";
    }
    cached = { ...cached, releaseOpenError };
    notify();
  }

  return {
    peek: () => cached,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: () => hydrate(),
    async apply(patch: SupportPreferencePatch) {
      const changedChannel = patch.allowPrerelease !== undefined &&
        patch.allowPrerelease !== cached.preferences.allowPrerelease;
      await persist(patch);
      if (changedChannel) {
        if (checkPromise) await checkPromise;
        return checkForUpdates();
      }
      return cached;
    },
    checkForUpdates,
    async checkOnLaunch() {
      if (launched) return checkPromise ?? cached;
      launched = true;
      try {
        await hydrate();
      } catch {
        setUpdate({ status: "error", message: "Could not load update settings. Try again." });
        return cached;
      }
      return checkForUpdates();
    },
    async checkOnForeground() {
      if (checkPromise) return checkPromise;
      try {
        await hydrate();
      } catch {
        setUpdate({ status: "error", message: "Could not load update settings. Try again." });
        return cached;
      }
      const { automaticForegroundUpdateChecks, checkFrequency, lastCheckAt } = cached.preferences;
      const intervals = { hourly: 3_600_000, daily: 86_400_000, weekly: 604_800_000 };
      return automaticForegroundUpdateChecks &&
        (lastCheckAt === null || Date.now() - lastCheckAt >= intervals[checkFrequency])
        ? checkForUpdates()
        : cached;
    },
    openApk: () => openRelease("apkUrl"),
    openRelease: () => openRelease("releaseUrl"),
    async buildReport() {
      const report = redactedLocalReport({
        installedVersion: cached.installedVersion,
        logs: input.logs.list(),
        preferences: cached.preferences,
      });
      await persist({ lastReport: report });
      resultCopy = "Built a redacted local report. Nothing was uploaded.";
      return hydrate();
    },
    async shareReport() {
      resultCopy = await input.share.share(
        cached.preferences.lastReport || "No local report is ready.",
      );
      return hydrate();
    },
    async requestMaintenance(kind) {
      pending = kind;
      resultCopy = "";
      return hydrate();
    },
    async cancelMaintenance() {
      pending = null;
      resultCopy = "Canceled. No local data changed.";
      return hydrate();
    },
    async confirmMaintenance() {
      const kind = pending;
      pending = null;
      if (!kind) return hydrate();
      resultCopy = await runMaintenance(input.maintenance, kind);
      return hydrate();
    },
  };
}

async function runMaintenance(
  maintenance: SupportMaintenancePort,
  kind: SupportMaintenanceKind,
): Promise<string> {
  switch (kind) {
    case "clear-history":
      return maintenance.clearHistory();
    case "remove-media":
      return maintenance.removeCompletedMedia();
    case "disconnect-accounts":
      return maintenance.disconnectAccounts();
    case "reset-app":
      return maintenance.resetApp();
  }
}
