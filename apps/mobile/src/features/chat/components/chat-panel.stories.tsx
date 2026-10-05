import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { ChatPanel } from "./chat-panel";
import { createChatInteractions } from "../domain/chat-interactions";
import type { ChatInteractions } from "../capabilities/chat-interactions";
import { mobileColors } from "@mobile/design/tokens";

const target = {
  channelId: "1",
  channelName: "streamer",
  platform: "twitch",
} as const;
const messages = [
  {
    id: "m1",
    displayName: "Viewer",
    username: "viewer",
    userId: "2",
    text: "Hello Kappa",
    color: "#a970ff",
    badges: [],
  },
];
function interactions(failure = false): ChatInteractions {
  return createChatInteractions(
    {
      access: async () => ({ allowed: true, detail: "Chatting as viewer." }),
      subscribe: () => () => undefined,
      send: async () =>
        failure
          ? {
              kind: "failed",
              detail: "Chat is rate limited. Wait before sending again.",
            }
          : { kind: "sent", messageId: "received-id" },
      userAction: async () => ({
        kind: "blocked",
        detail: "Complete reporting in the platform's user menu.",
      }),
    },
    {
      read: async () => ({
        emotes: [
          {
            id: "25",
            name: "Kappa",
            insertion: "Kappa",
            provider: "twitch",
            imageUrl:
              "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
          },
        ],
        failures: [],
      }),
    },
  );
}
const connected = interactions();
const failedSend = interactions(true);
const meta = {
  title: "Features/Chat",
  component: ChatPanel,
  decorators: [
    (Story) => (
      <View
        style={{
          height: 720,
          width: 380,
          padding: 16,
          backgroundColor: mobileColors.background,
        }}
      >
        <Story />
      </View>
    ),
  ],
  args: {
    chat: { kind: "live", detail: "Chat is live.", messages },
    platform: "twitch",
    target,
  },
} satisfies Meta<typeof ChatPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Guest: Story = {};
export const ComposerAndUserActions: Story = {
  args: { interactions: connected },
};
export const SendFailure: Story = { args: { interactions: failedSend } };
export const Replay: Story = {
  args: {
    recorded: true,
    title: "Comments",
    chat: {
      kind: "live",
      detail: "Recorded comments synchronized to playback.",
      messages: messages.map((message) => ({ ...message, offsetSeconds: 60 })),
    },
  },
};
export const ReplayFailure: Story = {
  args: {
    recorded: true,
    title: "Comments",
    chat: {
      kind: "failed",
      retry: "manual",
      detail: "Recorded chat request failed (429).",
    },
    onRetry: () => undefined,
  },
};
