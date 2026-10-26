import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AutoModQueue } from "../../../../../../components/screens/Mod/channel/workspace/AutoModQueue";
import { installPageFixtures } from "../ModChannelPage.stories";

const meta = {
  title: "Pages/Moderation/Workspace/AutoMod queue",
  component: AutoModQueue,
  args: { channelId: "1002048", channel: "novaarcade" },
  beforeEach: () => installPageFixtures("twitch-broadcaster-ready"),
  parameters: { layout: "centered" },
} satisfies Meta<typeof AutoModQueue>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No held messages.")).toBeInTheDocument();
  },
};
