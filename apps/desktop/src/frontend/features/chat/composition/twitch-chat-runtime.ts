import { twitchChatService } from "../adapters/browser/twitch-chat";
import { chatChannelLifecycle } from "../components/state/chat-channel-lifecycle";

twitchChatService.setChannelLifecycle(chatChannelLifecycle);

export { twitchChatService };
