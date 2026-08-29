import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";

import { TimeoutDurationPicker } from "./TimeoutDurationPicker";

const meta = {
  title: "Components/Chat/Moderation/Timeout Duration Picker",
  component: TimeoutDurationPicker,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[360px] rounded-lg border border-[#333] bg-[#0f0f12] p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    disabled: false,
    onChange: fn(),
  },
} satisfies Meta<typeof TimeoutDurationPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultTenMinutes: Story = {};

export const SevenDaysSelected: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "7d" }));
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
