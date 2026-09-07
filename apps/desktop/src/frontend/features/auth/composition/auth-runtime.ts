import { electronAuthRuntime } from "../adapters/electron/auth-runtime";
import type { AuthRuntime } from "../capabilities/auth-runtime";

export function getAuthRuntime(): AuthRuntime | undefined {
  return typeof window !== "undefined" && window.electronAPI
    ? electronAuthRuntime
    : undefined;
}
