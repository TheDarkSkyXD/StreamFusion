import type { SessionInspector } from "../capabilities/session-inspector";
import { electronSessionInspector } from "../adapters/electron/session-inspector";

export function getSessionInspector(): SessionInspector | undefined {
  return typeof window !== "undefined" && window.electronAPI?.auth
    ? electronSessionInspector
    : undefined;
}
