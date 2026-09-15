import type { AppMetadataReader } from "@mobile/features/diagnostics/capabilities/app-metadata";
import { redactDiagnosticExport } from "@mobile/features/diagnostics/domain/diagnostics-workspace";

import type {
  SupportLogPort,
  SupportMaintenanceKind,
  SupportMaintenancePort,
  SupportPreferencePatch,
  SupportReleaseCheckPort,
  SupportSettingsSession,
  SupportSettingsStore,
  SupportSettingsView,
  SupportSharePort,
} from "../capabilities/support-settings";
import {
  buildLocalReport,
  composeSupportSettingsView,
  defaultSupportSettingsView,
  mergeSupportSettings,
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
  readonly share: SupportSharePort;
  readonly store: SupportSettingsStore;
}): SupportSettingsSession {
  const listeners = new Set<() => void>();
  let cached = defaultSupportSettingsView(input.metadata.read().version);
  let pending: SupportMaintenanceKind | null = null;
  let resultCopy = "";

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
    });
    notify();
    return cached;
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
      await input.store.write(
        mergeSupportSettings(cached.preferences, patch),
      );
      return hydrate();
    },
    async checkForUpdates() {
      const checked = await input.releases.check(cached.installedVersion);
      await input.store.write(
        mergeSupportSettings(cached.preferences, {
          lastCheckAt: Date.now(),
          lastCheckCopy: checked.copy,
        }),
      );
      resultCopy = checked.copy;
      return hydrate();
    },
    async buildReport() {
      const report = redactedLocalReport({
        installedVersion: cached.installedVersion,
        logs: input.logs.list(),
        preferences: cached.preferences,
      });
      await input.store.write(
        mergeSupportSettings(cached.preferences, { lastReport: report }),
      );
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
