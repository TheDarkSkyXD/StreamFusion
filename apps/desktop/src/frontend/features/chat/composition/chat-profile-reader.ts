import type { ChatProfileReader } from "../capabilities/chat-profile-reader";
import { getDesktopChatProfileReader } from "../adapters/electron/chat-profile-reader";

export const getChatProfileReader: () => ChatProfileReader = getDesktopChatProfileReader;
