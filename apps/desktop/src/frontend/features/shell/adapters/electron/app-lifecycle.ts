import type { AppLifecycle } from "../../capabilities/app-lifecycle";

export const electronAppLifecycle = {
  onBeforeQuit: (callback: () => void) => window.electronAPI.onBeforeQuit(callback),
  closeWindow: () => window.electronAPI.closeWindow(),
} satisfies AppLifecycle;
