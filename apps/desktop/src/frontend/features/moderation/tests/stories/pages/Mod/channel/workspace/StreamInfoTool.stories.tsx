import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { StreamInfoTool } from "../../../../../../components/screens/Mod/channel/workspace/StreamInfoTool";
import { installPageFixtures } from "../ModChannelPage.stories";

const meta = {
  title: "Pages/Moderation/Workspace/Stream info",
  component: StreamInfoTool,
  args: { channelId: "1002048", channel: "novaarcade", refreshCounter: 0 },
  beforeEach: () => installPageFixtures("twitch-broadcaster-ready"),
  render: (args) => (
    <div className="w-[620px] bg-[#18181b] p-4 text-white">
      <StreamInfoTool {...args} />
    </div>
  ),
} satisfies Meta<typeof StreamInfoTool>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentStream: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByDisplayValue("A relaxed creative stream")
    ).toBeInTheDocument();
  },
};
