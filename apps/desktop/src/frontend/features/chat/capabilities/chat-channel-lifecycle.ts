import type { Platform } from "@streamfusion/core/platform";

export interface ChatChannelLifecycle {
  dropChannel(platform: Platform, channel: string): void;
}
