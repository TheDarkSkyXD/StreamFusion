import { ipcMain, net } from "electron";

import { checkInternetReachability } from "@/backend/services/connectivity-service";
import { IPC_CHANNELS } from "@shared/ipc-channels";

export function registerConnectivityHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONNECTIVITY_CHECK, () =>
    checkInternetReachability({
      request: (url, init) => net.fetch(url, init),
    })
  );
}
