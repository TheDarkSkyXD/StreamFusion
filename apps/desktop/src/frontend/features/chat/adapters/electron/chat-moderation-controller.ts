import type { ChatModerationController } from "../../capabilities/chat-moderation-controller";

export function getDesktopChatModerationController(): ChatModerationController {
 return window.electronAPI;
}
