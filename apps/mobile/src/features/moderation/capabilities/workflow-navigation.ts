import type { Platform } from "@streamfusion/core/platform";
import type { ModerationChannel } from "./moderation";

export interface PlatformWorkflowNavigation {
  openChannel(channel: ModerationChannel): Promise<void>;
  openModeration(
    channel: ModerationChannel | null,
    platform: Platform,
  ): Promise<void>;
}
