import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

import { ReconnectForModDialog } from "./ReconnectForModDialog";

function withReconnectState(missingScopes: string[], loading = false): Decorator {
  return (Story) => {
    useAuthStore.setState({ twitchLoading: loading });
    useReconnectDialogStore.setState({
      isOpen: true,
      missingScopes,
      onReconnected: null,
    });
    return <Story />;
  };
}

const meta = {
  title: "Components/Auth/ReconnectForModDialog",
  component: ReconnectForModDialog,
  parameters: {
    layout: "centered",
    docs: {
      story: { inline: false },
      description: {
        component:
          "A Twitch re-consent dialog that translates missing moderator scopes into plain-language permissions.",
      },
    },
  },
} satisfies Meta<typeof ReconnectForModDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MissingModeratorScopes: Story = {
  decorators: [
    withReconnectState([
      "moderator:manage:chat_messages",
      "moderator:manage:banned_users",
      "channel:manage:raids",
    ]),
  ],
};

export const UnknownScopeFallback: Story = {
  decorators: [withReconnectState(["moderator:manage:new_feature"])],
};

export const Reconnecting: Story = {
  decorators: [withReconnectState(["moderator:manage:chat_messages"], true)],
};
