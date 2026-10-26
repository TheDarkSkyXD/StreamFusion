import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, type ReactNode } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { KickChatConnectionStatus } from "../../../../components/chat/kick/KickChatConnectionStatus";
import { useChatStore } from "../../../../components/state/chat-store";

function DisconnectedChat({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = useChatStore.getState().connectionStatus;
    useChatStore.setState({
      connectionStatus: {
        ...previous,
        kick: { ...previous.kick, state: "reconnecting", channels: [] },
      },
    });
    return () => useChatStore.setState({ connectionStatus: previous });
  }, []);
  return children;
}

const meta = {
  title: "Components/Chat/KickChatConnectionStatus",
  component: KickChatConnectionStatus,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <DisconnectedChat>
        <div className="w-[420px] bg-[#1a1a1a] text-white">
          <Story />
        </div>
      </DisconnectedChat>
    ),
  ],
  args: { channel: "storybook-channel", startup: "ready", retry: fn() },
} satisfies Meta<typeof KickChatConnectionStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reconnecting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole("status")).toHaveTextContent(/reconnecting/i);
    await userEvent.click(canvas.getByRole("button", { name: /retry chat/i }));
    expect(args.retry).toHaveBeenCalledOnce();
  },
};

export const Failed: Story = {
  args: { startup: "failed" },
  play: async ({ canvasElement }) => {
    expect(await within(canvasElement).findByRole("alert")).toHaveTextContent(/could not connect/i);
  },
};
