import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { UserProfileHeader } from "./UserProfileHeader";

const knownIdentity = {
  state: "known" as const,
  source: "official" as const,
  value: {
    userId: "user-mira",
    username: "miramakes",
    displayName: "MiraMakes",
    avatarUrl: "https://static-cdn.jtvnw.net/jtv_user_pictures/mira.png",
  },
};

const meta = {
  title: "Components/Chat/User Info/Profile Header",
  component: UserProfileHeader,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[540px] rounded-lg bg-[#0f0f0f] p-5 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    fallbackUsername: "miramakes",
    identity: knownIdentity,
    accountCreated: {
      state: "known",
      source: "first-party-fallback",
      value: "2013-04-17T00:00:00Z",
    },
    follow: {
      state: "known",
      source: "official",
      value: "2021-07-08T00:00:00Z",
    },
    retryIdentity: fn(),
    retryAccountCreated: fn(),
    retryFollow: fn(),
  },
} satisfies Meta<typeof UserProfileHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const Unavailable: Story = {
  args: {
    accountCreated: { state: "failed", message: "Couldn’t verify" },
    follow: { state: "failed", message: "Unavailable" },
  },
};
