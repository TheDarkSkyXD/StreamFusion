import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { UiDebugTool } from "./UiDebugTool";

const meta = {
  title: "Components/Developer Tools/UI State",
  component: UiDebugTool,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[390px] rounded-lg border border-[#333] bg-[#101114] p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UiDebugTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NetworkBannerControls: Story = {};

export const OfflineSelected: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Show offline banner" })
    );
  },
};
