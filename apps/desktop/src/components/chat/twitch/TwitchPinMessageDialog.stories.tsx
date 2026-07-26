import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { TWITCH_MESSAGE } from "../chat-story-fixtures";
import { TwitchPinMessageDialog } from "./TwitchPinMessageDialog";

const meta = {
  title: "Components/Chat/Twitch/Pin Message Dialog",
  component: TwitchPinMessageDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: fn(),
    messagePreview: TWITCH_MESSAGE.rawContent,
    onConfirm: fn(),
  },
} satisfies Meta<typeof TwitchPinMessageDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThirtyMinutes: Story = {};

export const NoExpiry: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("radio", { name: "No expiry" }));
  },
};

export const Busy: Story = {
  args: { busy: true },
};
