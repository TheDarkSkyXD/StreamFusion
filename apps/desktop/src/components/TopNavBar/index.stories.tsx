import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { TwitchUser } from "@/shared/auth-types";
import { useAppStore } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";

import { withAppRouter } from "../../../.storybook/story-router";
import { TopNavBar } from ".";

const twitchUser: TwitchUser = {
  id: "twitch-1842",
  login: "novaarcade",
  displayName: "Nova Arcade",
  profileImageUrl: "",
  createdAt: "2021-04-18T16:30:00.000Z",
  broadcasterType: "partner",
};

function withNavigationState({
  collapsed = false,
  loggedIn = false,
}: {
  collapsed?: boolean;
  loggedIn?: boolean;
}): Decorator {
  return (Story) => {
    useAppStore.setState({
      sidebarCollapsed: collapsed,
      userPrefersSidebarCollapsed: collapsed,
      isTheaterModeActive: false,
    });
    useAuthStore.setState({
      twitchConnected: loggedIn,
      twitchUser: loggedIn ? twitchUser : null,
      kickConnected: false,
      kickUser: null,
      isGuest: !loggedIn,
      initialized: true,
    });
    return <Story />;
  };
}

const meta = {
  title: "Components/Top Navigation/TopNavBar",
  component: TopNavBar,
  parameters: {
    layout: "fullscreen",
    viewport: {
      defaultViewport: "responsive",
    },
    docs: {
      description: {
        component:
          "The app-wide navigation bar with sidebar control, brand, unified search, notifications, recording status, and profile access.",
      },
    },
  },
  decorators: [
    withAppRouter,
    (Story) => (
      <div className="min-w-[900px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TopNavBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoggedOut: Story = {
  decorators: [withNavigationState({})],
};

export const LoggedInWithNotifications: Story = {
  decorators: [withNavigationState({ loggedIn: true })],
};

export const CollapsedSidebar: Story = {
  decorators: [withNavigationState({ collapsed: true, loggedIn: true })],
};
