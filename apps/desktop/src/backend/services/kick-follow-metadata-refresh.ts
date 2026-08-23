import { createManagedInterval } from "../../lib/managed-interval";
import { kickClient } from "../api/platforms/kick/kick-client";
import { logger } from "../logging/logger";
import { isKickAccountReconciliationActive } from "./kick-account-reconciliation-coordinator";
import { repairKickFollowSlugs } from "./kick-follow-metadata-repair";
import { storageService } from "./storage-service";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let refreshTimer: { stop: () => void } | null = null;
let lastRefreshStartedAt = 0;
let inFlightRefresh: Promise<void> | null = null;

export async function refreshKickFollowMetadataNow(
  reason: string,
  options: { force?: boolean } = {}
): Promise<void> {
  if (isKickAccountReconciliationActive()) {
    logger.debug(
      "Service:KickFollowMetadata",
      "Deferring metadata refresh during follow reconciliation",
      {
        reason,
      }
    );
    return;
  }
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  const now = Date.now();
  if (!options.force && now - lastRefreshStartedAt < MIN_REFRESH_INTERVAL_MS) {
    logger.debug("Service:KickFollowMetadata", "Skipping Kick follow metadata refresh", {
      reason,
      msSinceLastRefresh: now - lastRefreshStartedAt,
    });
    return;
  }

  lastRefreshStartedAt = now;
  inFlightRefresh = (async () => {
    const follows = storageService.getLocalFollowsByPlatform("kick");
    if (follows.length === 0) {
      logger.debug("Service:KickFollowMetadata", "No Kick follows to refresh", { reason });
      return;
    }

    const repairedChannels = await repairKickFollowSlugs(kickClient, follows);
    logger.info("Service:KickFollowMetadata", "Kick follow metadata refresh completed", {
      reason,
      followCount: follows.length,
      resolvedCount: repairedChannels.size,
    });
  })();

  try {
    await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

export function startKickFollowMetadataRefresh(): void {
  if (refreshTimer) {
    return;
  }

  void refreshKickFollowMetadataNow("startup", { force: true });
  refreshTimer = createManagedInterval(
    () => {
      void refreshKickFollowMetadataNow("interval");
    },
    REFRESH_INTERVAL_MS,
    { unref: true }
  );
}

export function stopKickFollowMetadataRefresh(): void {
  if (!refreshTimer) {
    return;
  }

  refreshTimer.stop();
  refreshTimer = null;
}
