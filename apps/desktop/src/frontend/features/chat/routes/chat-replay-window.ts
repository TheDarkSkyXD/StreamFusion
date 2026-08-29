import type { ChatReplayMessage, VideoPlaybackSnapshot } from "../../../../shared/chat-replay-types";

const VISIBLE_REPLAY_LOOKBACK_SECONDS = 30;

export function selectVisibleChatReplayMessages(
  messages: ChatReplayMessage[],
  playback: VideoPlaybackSnapshot
): ChatReplayMessage[] {
  const minimumOffset = Math.max(0, playback.currentTime - VISIBLE_REPLAY_LOOKBACK_SECONDS);
  return messages.filter(
    (message) =>
      message.offsetSeconds >= minimumOffset && message.offsetSeconds <= playback.currentTime
  );
}
