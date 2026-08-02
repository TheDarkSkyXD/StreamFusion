import { describe, expect, it } from "vitest";
import { selectVisibleChatReplayMessages } from "@/hooks/chat-replay-window";
import type { ChatReplayMessage, VideoPlaybackSnapshot } from "@/shared/chat-replay-types";

const messages: ChatReplayMessage[] = [5, 10, 30, 50, 90].map((offsetSeconds) => ({
  id: `message-${offsetSeconds}`,
  offsetSeconds,
  sender: { id: "sender-1", login: "viewer", displayName: "Viewer" },
  badges: [],
  fragments: [{ type: "text", text: `${offsetSeconds}` }],
}));

function visibleOffsets(snapshot: VideoPlaybackSnapshot) {
  return selectVisibleChatReplayMessages(messages, snapshot).map(
    (message) => message.offsetSeconds
  );
}

// Guards: replay visibility follows media time through play, pause, seeks, and non-1x playback
describe("Chat Replay visible window", () => {
  it("rebuilds the trailing message window from each playback snapshot", () => {
    expect(visibleOffsets({ currentTime: 30, isPlaying: true, playbackRate: 1 })).toEqual([
      5, 10, 30,
    ]);
    expect(visibleOffsets({ currentTime: 30, isPlaying: false, playbackRate: 1 })).toEqual([
      5, 10, 30,
    ]);
    expect(visibleOffsets({ currentTime: 90, isPlaying: true, playbackRate: 1 })).toEqual([90]);
    expect(visibleOffsets({ currentTime: 10, isPlaying: true, playbackRate: 1 })).toEqual([5, 10]);
    expect(visibleOffsets({ currentTime: 50, isPlaying: true, playbackRate: 2 })).toEqual([30, 50]);
  });
});
