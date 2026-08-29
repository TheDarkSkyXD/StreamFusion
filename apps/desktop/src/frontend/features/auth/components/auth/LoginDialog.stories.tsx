import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import { useAuthStore } from "@/store/auth-store";

import { LoginDialog } from "./LoginDialog";

function withAuthLoading(twitchLoading: boolean): Decorator {
  return (Story) => {
    useAuthStore.setState({
      twitchConnected: false,
      kickConnected: false,
      twitchLoading,
      kickLoading: false,
      twitchUser: null,
      kickUser: null,
      isGuest: true,
      initialized: true,
    });
    return <Story />;
  };
}

const meta = {
  title: "Components/Auth/LoginDialog",
  component: LoginDialog,
  parameters: {
    layout: "centered",
    docs: {
      story: { inline: false },
      description: {
        component:
          "The first-run account chooser, including the available Twitch path, upcoming Kick path, and guest continuation.",
      },
    },
  },
  args: {
    open: true,
    onOpenChange: () => undefined,
  },
  decorators: [withAuthLoading(false)],
} satisfies Meta<typeof LoginDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ConnectingTwitch: Story = {
  decorators: [withAuthLoading(true)],
};
