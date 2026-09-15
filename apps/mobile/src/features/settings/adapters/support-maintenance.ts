import {
  DEFAULT_PRODUCT_PREFERENCES,
  serializeProductPreferences,
} from "@streamfusion/core/settings";
import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import type {
  MediaJobRepository,
  ProductSettingsStore,
} from "@mobile/features/storage/capabilities/persistence";

import { PRODUCT_SETTINGS_KEY } from "../capabilities/settings";
import type {
  SupportMaintenancePort,
  SupportSettingsStore,
} from "../capabilities/support-settings";
import { DEFAULT_SUPPORT_SETTINGS } from "../domain/support-settings";

const REMOVABLE_PHASES = new Set([
  "completed",
  "failed-terminal",
  "canceled",
]);

export function createSupportMaintenancePort(input: {
  readonly cacheClear: () => Promise<void>;
  readonly connectedAccount: () => Promise<boolean>;
  readonly history: WatchHistoryRepository;
  readonly jobs: MediaJobRepository;
  readonly settings: ProductSettingsStore;
  readonly support: SupportSettingsStore;
}): SupportMaintenancePort {
  return {
    async clearHistory() {
      const before = await input.history.list();
      await input.history.clear();
      return `Cleared ${before.length} History rows. Guest Follows and jobs stay.`;
    },
    async disconnectAccounts() {
      const connected = await input.connectedAccount();
      if (!connected) {
        return "No connected account. Guest Follows stay. OAuth is not started.";
      }
      return "Connected-account disconnect waits for the OAuth tickets. Guest Follows stay.";
    },
    async removeCompletedMedia() {
      const jobs = await input.jobs.list();
      const removable = jobs.filter((job) => REMOVABLE_PHASES.has(job.phase));
      for (const job of removable) {
        await input.jobs.remove(job.intent.jobId);
      }
      return removable.length === 0
        ? "No completed, canceled, or failed app-private jobs to remove."
        : `Removed ${removable.length} completed media jobs. Active jobs stay.`;
    },
    async resetApp() {
      await input.history.clear();
      await input.cacheClear();
      await input.settings.write(
        PRODUCT_SETTINGS_KEY,
        serializeProductPreferences(DEFAULT_PRODUCT_PREFERENCES),
        Date.now(),
      );
      await input.support.write(DEFAULT_SUPPORT_SETTINGS);
      return "Reset product Settings, support Settings, History, and the disposable cache. Guest Follows stay.";
    },
  };
}
