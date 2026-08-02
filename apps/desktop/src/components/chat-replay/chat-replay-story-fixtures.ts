import type { ChatReplayMessage, ChatReplayWindowResult } from "@/shared/chat-replay-types";

export const chatReplayMessages: ChatReplayMessage[] = [
  {
    id: "replay-message-1",
    offsetSeconds: 3_602,
    sender: {
      id: "user-1",
      login: "pixelnomad",
      displayName: "PixelNomad",
      color: "#59BFFF",
    },
    badges: [
      {
        id: "subscriber-24",
        setId: "subscriber",
        version: "24",
        title: "24-month subscriber",
      },
    ],
    fragments: [
      { type: "text", text: "That timing was perfect " },
      { type: "emote", text: "PogChamp", emoteId: "305954156" },
    ],
  },
  {
    id: "replay-message-2",
    offsetSeconds: 3_610,
    sender: {
      id: "user-2",
      login: "miramakes",
      displayName: "MiraMakes",
      color: "#70AD47",
    },
    badges: [],
    fragments: [
      {
        type: "text",
        text: "Clip it, @PixelNomad — https://streamfusion.app/highlights",
      },
    ],
  },
  {
    id: "replay-message-3",
    offsetSeconds: 3_622,
    sender: {
      id: "user-3",
      login: "riftrunner",
      displayName: "RiftRunner",
      color: "#FF7F7F",
    },
    badges: [],
    fragments: [{ type: "text", text: "One more round!" }],
  },
];

export const supportedChatReplay: ChatReplayWindowResult = {
  capability: "supported",
  platform: "twitch",
  videoId: "vod-story-123",
  messages: chatReplayMessages,
  nextCursor: null,
  hasNextPage: false,
};

export const emptyChatReplay: ChatReplayWindowResult = {
  capability: "empty",
  platform: "twitch",
  videoId: "vod-story-123",
};
