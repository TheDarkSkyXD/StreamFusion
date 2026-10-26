import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { NativeToolsPanel } from "../../../../../../components/screens/Mod/channel/workspace/NativeToolsPanel";

const meta = {
  title: "Pages/Moderation/Workspace/Native tools",
  component: NativeToolsPanel,
  args: { channel: "fixture_owner" },
} satisfies Meta<typeof NativeToolsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Tools: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByRole("button", { name: "Open Twitch Mod View" })
    ).toHaveLength(4);
  },
};
