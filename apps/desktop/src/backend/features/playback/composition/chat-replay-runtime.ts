import { fetchKickChatReplayPage } from "../adapters/kick/kick-chat-replay-source";
import { fetchTwitchChatReplayPage } from "../adapters/twitch/twitch-chat-replay-source";
import { createChatReplayService } from "../domain/chat-replay-service";

export const chatReplayService = createChatReplayService({
  twitch: { loadWindow: fetchTwitchChatReplayPage },
  kick: { loadWindow: fetchKickChatReplayPage, paginationDirection: "backward" },
});
