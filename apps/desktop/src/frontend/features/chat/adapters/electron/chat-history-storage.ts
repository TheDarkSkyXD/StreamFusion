import type { ChatHistoryStorage } from "../../capabilities/chat-history-storage";

export function getDesktopChatHistoryStorage(): ChatHistoryStorage {
 return window.electronAPI;
}
