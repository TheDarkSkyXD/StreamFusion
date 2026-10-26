import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, within } from "storybook/test";
import {
  ModChatPanel,
  ModVideoPanel,
} from "../../../../../../components/screens/Mod/channel/workspace/ModLivePanels";
import { installPageFixtures, PageQueryProvider } from "../ModChannelPage.stories";

type PanelArgs = ComponentProps<typeof ModVideoPanel> & { panel: "video" | "chat" };
const meta = {
  title: "Pages/Moderation/Workspace/Live panels",
  component: ModVideoPanel,
  args: { platform: "twitch", channel: "novaarcade", channelId: "1002048", panel: "video" },
  beforeEach: () => installPageFixtures("twitch-broadcaster-ready"),
  render: ({ panel, platform, channel, channelId }) => (
    <PageQueryProvider>
      <div className="h-[420px] w-[600px]">
        {panel === "video" ? (
          <ModVideoPanel platform={platform} channel={channel} channelId={channelId} />
        ) : (
          <ModChatPanel platform={platform} channel={channel} channelId={channelId} />
        )}
      </div>
    </PageQueryProvider>
  ),
} satisfies Meta<PanelArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Video: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("mod-story-video")).toBeInTheDocument();
  },
};
export const Chat: Story = {
  args: { panel: "chat" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("mod-story-chat")).toBeInTheDocument();
  },
};
