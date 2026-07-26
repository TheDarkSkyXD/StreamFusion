import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { KickUser, TwitchUser } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { AccountConnect } from "./AccountConnect";

const twitchUser: TwitchUser = {
  id: "twitch-1842",
  login: "novaarcade",
  displayName: "Nova Arcade",
  profileImageUrl: "",
  createdAt: "2021-04-18T16:30:00.000Z",
  broadcasterType: "partner",
};

const kickUser: KickUser = {
  id: 7421,
  username: "NovaArcade",
  slug: "novaarcade",
  profilePic: "",
  verified: true,
};

function withAccounts(state: {
  twitchConnected?: boolean;
  kickConnected?: boolean;
  twitchLoading?: boolean;
  kickLoading?: boolean;
}): Decorator {
  return (Story) => {
    useAuthStore.setState({
      twitchConnected: state.twitchConnected ?? false,
      kickConnected: state.kickConnected ?? false,
      twitchLoading: state.twitchLoading ?? false,
      kickLoading: state.kickLoading ?? false,
      twitchUser: state.twitchConnected ? twitchUser : null,
      kickUser: state.kickConnected ? kickUser : null,
      isGuest: !state.twitchConnected && !state.kickConnected,
      initialized: true,
    });
    return <Story />;
  };
}

const meta = {
  title: "Components/Auth/AccountConnect",
  component: AccountConnect,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Account connection cards for Twitch and Kick, driven by the same authentication store as the desktop app.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-4xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountConnect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  decorators: [withAccounts({})],
};

export const BothConnected: Story = {
  decorators: [withAccounts({ twitchConnected: true, kickConnected: true })],
};

export const ConnectingTwitch: Story = {
  decorators: [withAccounts({ twitchLoading: true })],
};

export const MixedConnection: Story = {
  decorators: [withAccounts({ twitchConnected: true })],
};
