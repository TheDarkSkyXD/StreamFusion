import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { KickPinMessageDialog } from "./KickPinMessageDialog";

const meta = {
  title: "Components/Chat/Kick/Pin Message Dialog",
  component: KickPinMessageDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: fn(),
    messagePreview: "Community games start after this match. Stay tuned!",
    onConfirm: fn(),
  },
} satisfies Meta<typeof KickPinMessageDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwentyMinutes: Story = {};

export const Busy: Story = {
  args: { busy: true },
};
