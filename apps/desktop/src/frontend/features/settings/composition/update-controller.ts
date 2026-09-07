import type { UpdateController } from "../capabilities/update-controller";
import { electronUpdateController } from "../adapters/electron/update-controller";

export function getUpdateController(): UpdateController | undefined {
  return typeof window !== "undefined" && window.electronAPI?.updater
    ? electronUpdateController
    : undefined;
}
