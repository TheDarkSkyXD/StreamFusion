import type { ChatPresentationServices } from "../capabilities/chat-presentation-services";
import { getDesktopChatPresentationServices } from "../adapters/electron/chat-presentation-services";

export const getChatPresentationServices: () => ChatPresentationServices | undefined = getDesktopChatPresentationServices;
