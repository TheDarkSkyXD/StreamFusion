import type { UserPreferences } from "@shared/auth-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { trustedIpcMain as ipcMain } from "../../../ipc/trusted-ipc-main";
import { preferencesRepository } from "../data/preferences-repository";

export function registerPreferenceRoutes(
  preferences: Pick<
    typeof preferencesRepository,
    "getPreferences" | "updatePreferences" | "resetPreferences"
  > = preferencesRepository
): void {
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_GET, () => preferences.getPreferences());
  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES_UPDATE,
    (_event, { updates }: { updates: Partial<UserPreferences> }) =>
      preferences.updatePreferences(updates)
  );
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_RESET, () => preferences.resetPreferences());
}
