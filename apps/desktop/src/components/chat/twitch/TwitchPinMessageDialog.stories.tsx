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
    message: TWITCH_MESSAGE,
    onConfirm: fn(),
  },
} satisfies Meta<typeof TwitchPinMessageDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThirtyMinutes: Story = {};

export const CustomDuration: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("radio", { name: "Custom" }));
    await userEvent.clear(body.getByRole("spinbutton", { name: "Custom pin duration" }));
    await userEvent.type(body.getByRole("spinbutton", { name: "Custom pin duration" }), "90");
  },
};

export const Busy: Story = {
  args: { busy: true },
};
