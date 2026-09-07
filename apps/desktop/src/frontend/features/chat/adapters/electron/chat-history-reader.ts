import type { ChatHistoryReader } from "../../capabilities/chat-history-reader";

export function getDesktopChatHistoryReader(): ChatHistoryReader {
 return window.electronAPI;
}
