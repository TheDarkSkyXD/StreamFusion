import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ChannelWorkspace } from "../../../../../../components/screens/Mod/channel/workspace/ChannelWorkspace";
import { installPageFixtures, PageQueryProvider } from "../ModChannelPage.stories";

const meta = {
  title: "Pages/Moderation/Workspace/Channel workspace",
  component: ChannelWorkspace,
  args: {
    platform: "twitch",
    channel: "novaarcade",
    channelId: "1002048",
    displayName: "NovaArcade",
    retentionScope: "channel:twitch:1002048",
    isOwnBroadcaster: true,
    hasModerationAuthority: true,
    refreshCounter: 0,
  },
  beforeEach: () => installPageFixtures("twitch-broadcaster-ready"),
  render: (args) => (
    <PageQueryProvider>
      <div className="h-[850px] min-w-[760px]">
        <ChannelWorkspace {...args} />
      </div>
    </PageQueryProvider>
  ),
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ChannelWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BroadcasterWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("mod-workspace")).toBeInTheDocument();
    await expect(canvas.getByRole("navigation", { name: "Moderation tools" })).toBeInTheDocument();
  },
};
