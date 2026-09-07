import type { KickChatController } from "../../capabilities/kick-chat-controller";

export function getDesktopKickChatController(): KickChatController {
 return window.electronAPI;
}
