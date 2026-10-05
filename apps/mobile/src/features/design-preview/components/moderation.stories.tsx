import type { Meta, StoryObj } from "@storybook/react-native-web-vite";

import { ModerationMockup } from "./moderation-mockups";

const meta = {
  title: "Android/Proposed/Moderation",
  component: ModerationMockup,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The production mobile Moderation destination is a placeholder. These Android proposals use local fixtures. No roles are verified and no moderation API is called. Twitch AutoMod and Kick retention remain provider-specific.",
      },
    },
  },
} satisfies Meta<typeof ModerationMockup>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Home: Story = { args: { kind: "home" } };
export const TwitchWorkspace: Story = {
  args: { kind: "workspace", platform: "twitch" },
};
export const KickWorkspace: Story = {
  args: { kind: "workspace", platform: "kick" },
};
export const LiveChat: Story = { args: { kind: "chat" } };
export const AutoModQueue: Story = { args: { kind: "automod" } };
export const KickRetention: Story = {
  args: { kind: "retention", platform: "kick" },
};
export const ModActions: Story = { args: { kind: "logs" } };
export const BannedUsers: Story = { args: { kind: "banned" } };
export const UnbanRequests: Story = { args: { kind: "unban" } };
export const Moderators: Story = { args: { kind: "moderators" } };
export const Vips: Story = { args: { kind: "vips" } };
export const StreamTools: Story = { args: { kind: "stream" } };
export const ChannelActivity: Story = { args: { kind: "activity" } };
export const Community: Story = { args: { kind: "community" } };
export const Rewards: Story = { args: { kind: "rewards" } };
export const SuspiciousActivity: Story = { args: { kind: "suspicious" } };
export const Whispers: Story = { args: { kind: "whispers" } };
export const ProviderTools: Story = { args: { kind: "provider" } };
export const UserHistorySheet: Story = { args: { kind: "user-history" } };
export const TimeoutSheet: Story = { args: { kind: "timeout" } };
export const RaidTargetPicker: Story = { args: { kind: "raid" } };
