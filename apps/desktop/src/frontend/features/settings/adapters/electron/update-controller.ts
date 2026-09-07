import type { UpdateController } from "../../capabilities/update-controller";

type UpdateBridge = typeof window.electronAPI.updater;

export const electronUpdateController = {
  check: () => window.electronAPI.updater.check(),
  download: () => window.electronAPI.updater.download(),
  install: () => window.electronAPI.updater.install(),
  getStatus: () => window.electronAPI.updater.getStatus(),
  setAllowPrerelease: (...args: Parameters<UpdateBridge["setAllowPrerelease"]>) =>
    window.electronAPI.updater.setAllowPrerelease(...args),
  setAutoCheck: (...args: Parameters<UpdateBridge["setAutoCheck"]>) =>
    window.electronAPI.updater.setAutoCheck(...args),
  onStatusChange: (...args: Parameters<UpdateBridge["onStatusChange"]>) =>
    window.electronAPI.updater.onStatusChange(...args),
  onProgress: (...args: Parameters<UpdateBridge["onProgress"]>) =>
    window.electronAPI.updater.onProgress(...args),
} satisfies UpdateController;
