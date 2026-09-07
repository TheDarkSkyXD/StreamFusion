import type { AppLifecycle } from "../capabilities/app-lifecycle";
import { electronAppLifecycle } from "../adapters/electron/app-lifecycle";

export function getAppLifecycle(): AppLifecycle | undefined {
  return typeof window !== "undefined" && typeof window.electronAPI?.onBeforeQuit === "function"
    ? electronAppLifecycle
    : undefined;
}
