import type { ChatSessionAccess } from "../../capabilities/chat-session-access";

export function getDesktopChatSessionAccess(): ChatSessionAccess {
 return window.electronAPI;
}
