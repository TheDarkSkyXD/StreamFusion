import { kickChatService } from "../adapters/browser/kick-chat";
import { chatChannelLifecycle } from "../components/state/chat-channel-lifecycle";

kickChatService.setChannelLifecycle(chatChannelLifecycle);

export { kickChatService };
