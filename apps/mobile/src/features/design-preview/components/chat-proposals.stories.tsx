import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { WatchMockup } from "./watch-mockups";

const meta = {
  title: "Android/Proposed/Chat and engagement",
  component: WatchMockup,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Design proposals for desktop workflows without complete mobile capabilities. These stories use local state. They do not send chat, spend points, vote, replay provider messages, or run caption models.",
      },
    },
  },
} satisfies Meta<typeof WatchMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Composer: Story = { args: { kind: "composer" } };
export const EmotePickerSheet: Story = { args: { kind: "emotes" } };
export const UserActionsSheet: Story = { args: { kind: "user" } };
export const RecordedChatReplay: Story = { args: { kind: "replay" } };
export const PredictionSheet: Story = { args: { kind: "prediction" } };
export const PollSheet: Story = { args: { kind: "poll" } };
export const LiveCaptions: Story = { args: { kind: "captions" } };
