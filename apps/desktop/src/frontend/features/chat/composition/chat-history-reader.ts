import type { ChatHistoryReader } from "../capabilities/chat-history-reader";
import { getDesktopChatHistoryReader } from "../adapters/electron/chat-history-reader";

export const getChatHistoryReader: () => ChatHistoryReader = getDesktopChatHistoryReader;
