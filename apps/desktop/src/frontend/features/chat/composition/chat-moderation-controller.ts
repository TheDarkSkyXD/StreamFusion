import type { ChatModerationController } from "../capabilities/chat-moderation-controller";
import { getDesktopChatModerationController } from "../adapters/electron/chat-moderation-controller";

export const getChatModerationController: () => ChatModerationController = getDesktopChatModerationController;
