import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { FollowingChannelGrid } from "../../../../components/screens/Following/following-channel-grid";
import { followedChannels } from "./story-fixtures";

const channels = followedChannels.slice(0, 16);

const meta = {
  title: "Pages/Following/FollowingChannelGrid",
  component: FollowingChannelGrid,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[560px] w-full bg-[#0f0f0f] p-4 text-white">
        <Story />
      </div>
    ),
  ],
  args: {
    items: channels,
    getItemKey: (channel) => `${channel.platform}:${channel.id}`,
    renderItem: (channel) => (
      <button
        type="button"
        className="h-full w-full rounded-lg border border-[#333] bg-[#252525] p-4 text-left focus-visible:ring-2 focus-visible:ring-white"
      >
        <span className="text-xs uppercase text-[#a0a0a0]">{channel.platform}</span>
        <span className="mt-3 block font-semibold">{channel.displayName}</span>
      </button>
    ),
  },
} satisfies Meta<typeof FollowingChannelGrid<(typeof channels)[number]>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FollowedChannels: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstChannel = await canvas.findByRole("button", {
      name: new RegExp(channels[0].displayName, "i"),
    });
    await userEvent.click(firstChannel);
    expect(firstChannel).toHaveFocus();
    expect(canvas.getByTestId("following-channel-grid")).toContainElement(firstChannel);
  },
};
