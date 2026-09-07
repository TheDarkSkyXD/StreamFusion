import type { ChatHistoryStorage } from "../capabilities/chat-history-storage";
import { getDesktopChatHistoryStorage } from "../adapters/electron/chat-history-storage";

export const getChatHistoryStorage: () => ChatHistoryStorage = getDesktopChatHistoryStorage;
