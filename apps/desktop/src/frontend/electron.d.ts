/**
 * Type declarations for the Electron API exposed via preload
 */

import type { ElectronAPI } from "../backend/preload/index";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
