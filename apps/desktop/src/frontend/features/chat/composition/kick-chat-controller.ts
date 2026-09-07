import type { KickChatController } from "../capabilities/kick-chat-controller";
import { getDesktopKickChatController } from "../adapters/electron/kick-chat-controller";

export const getKickChatController: () => KickChatController = getDesktopKickChatController;
