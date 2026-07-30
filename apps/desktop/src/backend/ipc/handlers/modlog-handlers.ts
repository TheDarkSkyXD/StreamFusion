import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type {
  ModLogQueryFilters,
  ModLogWriteEntry,
  RetentionScope,
} from "../../../shared/mod-log-types";
import { dbService } from "../../services/database-service";
import { authorizeModerationHistory } from "../../services/moderation-history-authorization";
import { isAllowedSender } from "../sender-origin";

export function registerModLogHandlers(): void {
  // ========== Mod Log ==========
  ipcMain.handle(
    IPC_CHANNELS.MODLOG_INSERT,
    async (event, { entry }: { entry: ModLogWriteEntry }) => {
      if (!isAllowedSender(event)) {
        return { success: false, code: "forbidden", retryable: false } as const;
      }
      const platform = entry?.platform;
      const validProvenance =
        (platform === "twitch" &&
          (entry.provenance === "twitch-eventsub" ||
            entry.provenance === "twitch-observed" ||
            entry.provenance === "twitch-helix-current-state" ||
            entry.provenance === "streamfusion-confirmed")) ||
        (platform === "kick" &&
          (entry.provenance === "kick-observed" || entry.provenance === "streamfusion-confirmed"));
      if (
        (platform !== "twitch" && platform !== "kick") ||
        !validProvenance ||
        !entry.channelId?.trim() ||
        !entry.channelSlug?.trim() ||
        !Number.isFinite(entry.occurredAt) ||
        !Number.isFinite(entry.observedAt)
      ) {
        return { success: false, code: "invalid-entry", retryable: false } as const;
      }

      const authorization = await authorizeModerationHistory({
        platform,
        channelId: entry.channelId,
        channelSlug: entry.channelSlug,
      });
      if (authorization.state !== "authorized") {
        const unverified = authorization.reason === "unverified";
        return {
          success: false,
          code: unverified ? "unverified" : "unauthorized",
          retryable: unverified,
        } as const;
      }

      try {
        const id = dbService.insertModLog(entry);
        const currentCoverage = dbService.getModLogCoverage(platform, entry.channelId);
        if (currentCoverage?.coverage !== "complete") {
          dbService.setModLogCoverage({
            platform,
            channelId: entry.channelId,
            coverage: "partial",
            source: entry.provenance,
            coverageStartAt: Math.min(
              currentCoverage?.coverageStartAt ?? entry.occurredAt,
              entry.occurredAt
            ),
            coverageEndAt: Math.max(
              currentCoverage?.coverageEndAt ?? entry.occurredAt,
              entry.occurredAt
            ),
            observedAt: Math.max(currentCoverage?.observedAt ?? entry.observedAt, entry.observedAt),
          });
        }
        return { success: true, id } as const;
      } catch {
        return { success: false, code: "write-failed", retryable: true } as const;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.MODLOG_QUERY,
    async (event, { filters }: { filters: ModLogQueryFilters }) => {
      if (!isAllowedSender(event)) {
        return {
          state: "error",
          entries: [],
          code: "forbidden",
          retryable: false,
        } as const;
      }
      if (
        !filters ||
        (filters.platform !== "twitch" && filters.platform !== "kick") ||
        !filters.channelId?.trim() ||
        !filters.channelSlug?.trim()
      ) {
        return {
          state: "error",
          entries: [],
          code: "unverified",
          retryable: false,
        } as const;
      }
      const authorization = await authorizeModerationHistory({
        platform: filters.platform,
        channelId: filters.channelId,
        channelSlug: filters.channelSlug,
      });
      if (authorization.state !== "authorized") {
        const unverified = authorization.reason === "unverified";
        return {
          state: "error",
          entries: [],
          code: unverified ? "unverified" : "unauthorized",
          retryable: unverified,
        } as const;
      }
      try {
        const entries = dbService.queryModLog(filters);
        const coverage = dbService.getModLogCoverage(filters.platform, filters.channelId);
        if (coverage?.coverage !== "complete") {
          return {
            state: "partial",
            entries,
            coverage: "partial",
            reason: "observation-window",
          } as const;
        }
        return entries.length === 0
          ? ({ state: "verified-empty", entries: [], coverage: "complete" } as const)
          : ({ state: "ready", entries, coverage: "complete" } as const);
      } catch {
        return {
          state: "error",
          entries: [],
          code: "query-failed",
          retryable: true,
        } as const;
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.MODLOG_SWEEP_RETENTION, (_event, { now }: { now?: number } = {}) => {
    return dbService.sweepModLogRetention(now);
  });

  // ========== Retention Settings ==========
  ipcMain.handle(IPC_CHANNELS.RETENTION_GET, (_event, { scope }: { scope: RetentionScope }) => {
    return dbService.getRetentionSetting(scope);
  });

  ipcMain.handle(
    IPC_CHANNELS.RETENTION_SET,
    (_event, { scope, days }: { scope: RetentionScope; days: number | null }) => {
      dbService.setRetentionSetting(scope, days);
    }
  );
}
