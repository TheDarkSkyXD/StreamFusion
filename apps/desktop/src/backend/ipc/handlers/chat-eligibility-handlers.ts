import { ipcMain } from "electron";

import { logger } from "@/backend/logging/logger";
import { checkSubscriberEligibility } from "@/backend/services/chat/subscriber-eligibility";
import type { SubscriberEligibilityResult } from "@/shared/chat-types";
import { IPC_CHANNELS, type IpcPayloads } from "@/shared/ipc-channels";
import { isAllowedSender } from "../sender-origin";

export function registerChatEligibilityHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.CHAT_CHECK_SUBSCRIBER_ELIGIBILITY,
    async (
      event,
      request: IpcPayloads[typeof IPC_CHANNELS.CHAT_CHECK_SUBSCRIBER_ELIGIBILITY]
    ): Promise<SubscriberEligibilityResult> => {
      if (!isAllowedSender(event)) {
        logger.warn(
          "IPC:ChatEligibility",
          "CHAT_CHECK_SUBSCRIBER_ELIGIBILITY rejected: disallowed sender origin"
        );
        return { status: "unknown" };
      }

      return checkSubscriberEligibility(request);
    }
  );
}
