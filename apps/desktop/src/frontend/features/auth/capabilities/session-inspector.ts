import type { Platform } from "@streamfusion/core/platform";
import type { TokenStatusResult } from "@shared/ipc-channels";

export interface SessionInspector {
  tokenStatus(platform: Platform): Promise<TokenStatusResult>;
}
