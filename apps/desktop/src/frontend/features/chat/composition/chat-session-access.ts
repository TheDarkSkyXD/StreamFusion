import type { ChatSessionAccess } from "../capabilities/chat-session-access";
import { getDesktopChatSessionAccess } from "../adapters/electron/chat-session-access";

export const getChatSessionAccess: () => ChatSessionAccess = getDesktopChatSessionAccess;
