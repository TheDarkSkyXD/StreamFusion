import { net } from "electron";

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { IPC_CHANNELS } from "@shared/ipc-channels";

export function registerConnectivityHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CONNECTIVITY_CHECK, () => ({
    status: net.isOnline() ? "online" : "offline",
  }));
}
