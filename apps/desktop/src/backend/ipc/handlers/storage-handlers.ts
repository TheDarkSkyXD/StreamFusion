import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { IPC_CHANNELS } from "@shared/ipc-channels";
import { storageService } from "../../services/storage-service";

/** Process-wide untyped key-value compatibility channels. Feature routes own typed state. */
export function registerStorageHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.STORE_GET, (_event, { key }: { key: string }) =>
    storageService.get(key)
  );
  ipcMain.handle(IPC_CHANNELS.STORE_SET, (_event, { key, value }: { key: string; value: unknown }) => {
    storageService.set(key, value);
  });
  ipcMain.handle(IPC_CHANNELS.STORE_DELETE, (_event, { key }: { key: string }) => {
    storageService.delete(key);
  });
}
