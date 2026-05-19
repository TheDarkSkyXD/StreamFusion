import { ipcMain } from "electron";

import type {
  ModLogEntry,
  ModLogQueryFilters,
  RetentionScope,
} from "../../../shared/mod-log-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { dbService } from "../../services/database-service";

export function registerModLogHandlers(): void {
  // ========== Mod Log ==========
  ipcMain.handle(
    IPC_CHANNELS.MODLOG_INSERT,
    (_event, { entry }: { entry: Omit<ModLogEntry, "id"> }) => {
      return dbService.insertModLog(entry);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MODLOG_QUERY,
    (_event, { filters }: { filters: ModLogQueryFilters }) => {
      return dbService.queryModLog(filters);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MODLOG_SWEEP_RETENTION,
    (_event, { now }: { now?: number } = {}) => {
      return dbService.sweepModLogRetention(now);
    },
  );

  // ========== Retention Settings ==========
  ipcMain.handle(
    IPC_CHANNELS.RETENTION_GET,
    (_event, { scope }: { scope: RetentionScope }) => {
      return dbService.getRetentionSetting(scope);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RETENTION_SET,
    (
      _event,
      { scope, days }: { scope: RetentionScope; days: number | null },
    ) => {
      dbService.setRetentionSetting(scope, days);
    },
  );
}
