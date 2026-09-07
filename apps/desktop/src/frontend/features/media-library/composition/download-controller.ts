import type { DownloadController } from "../capabilities/download-controller";
import { electronDownloadController } from "../adapters/electron/download-controller";

/** Resolve the desktop controller when it is needed so late test bridges work too. */
export function getDownloadController(): DownloadController | undefined {
  return (
  typeof window !== "undefined" && window.electronAPI?.downloads
    ? electronDownloadController
    : undefined
  );
}
