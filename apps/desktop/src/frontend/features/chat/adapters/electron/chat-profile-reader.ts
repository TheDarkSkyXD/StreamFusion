import type { ChatProfileReader } from "../../capabilities/chat-profile-reader";

export function getDesktopChatProfileReader(): ChatProfileReader {
 return window.electronAPI;
}
