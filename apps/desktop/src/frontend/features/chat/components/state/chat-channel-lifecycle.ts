import type { ChatChannelLifecycle } from "../../capabilities/chat-channel-lifecycle";
import { buildChannelKey, useChatStore } from "./chat-store";

export const chatChannelLifecycle: ChatChannelLifecycle = {
  dropChannel: (platform, channel) => {
    useChatStore.getState().dropChannel(buildChannelKey(platform, channel));
  },
};
