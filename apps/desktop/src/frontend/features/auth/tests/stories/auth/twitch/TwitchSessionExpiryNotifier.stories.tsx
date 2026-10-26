import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { toast } from "sonner";

import { ToastRoot } from "@/features/shell/components/ToastRoot";
import { useAuthStore } from "../../../../components/state/auth-store";
import { TwitchSessionExpiryNotifier } from "../../../../components/auth/twitch/TwitchSessionExpiryNotifier";

const reconnect = fn(async () => undefined);

function ExpiredSessionPreview() {
  useEffect(() => {
    const previous = useAuthStore.getState();
    useAuthStore.setState({
      initialized: true,
      twitchReconnectRequired: true,
      loginTwitch: reconnect,
    });
    return () => {
      useAuthStore.setState({
        initialized: previous.initialized,
        twitchReconnectRequired: previous.twitchReconnectRequired,
        loginTwitch: previous.loginTwitch,
      });
      toast.dismiss("twitch-session-expired");
    };
  }, []);
  return (
    <>
      <TwitchSessionExpiryNotifier />
      <ToastRoot />
    </>
  );
}

const meta = {
  title: "Components/Auth/TwitchSessionExpiryNotifier",
  component: TwitchSessionExpiryNotifier,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TwitchSessionExpiryNotifier>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExpiredSession: Story = {
  render: () => <ExpiredSessionPreview />,
  play: async ({ canvasElement }) => {
    reconnect.mockClear();
    const canvas = within(canvasElement.ownerDocument.body);
    expect(await canvas.findByText("Signed out of Twitch")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Reconnect" }));
    expect(reconnect).toHaveBeenCalledOnce();
  },
};
