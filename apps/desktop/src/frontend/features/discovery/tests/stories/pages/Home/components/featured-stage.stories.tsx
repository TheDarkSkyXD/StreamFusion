import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, spyOn, userEvent, within } from "storybook/test";

import { withAppRouter } from "../../../../../../../../../.storybook/story-router";
import { makeChannel } from "../../../../../../../../../.storybook/catalog-fixtures";
import { ChatPanel, type ChatPanelProps } from "@/features/chat/components/chat/ChatPanel";
import { discoveryReader } from "@/features/discovery/composition/discovery-reader";
import { FeaturedStage } from "../../../../../components/screens/Home/components/featured-stage";
import { homeStreamFixtures } from "../story-fixtures";

function hasChatRenderer(
  component: unknown
): component is { type: (props: ChatPanelProps) => ReactNode } {
  return (
    typeof component === "object" &&
    component !== null &&
    "type" in component &&
    typeof component.type === "function"
  );
}

const meta = {
  title: "Pages/Home/FeaturedStage",
  component: FeaturedStage,
  decorators: [withAppRouter],
  beforeEach: () => {
    if (!hasChatRenderer(ChatPanel)) {
      throw new Error("The chat preview requires the memoized ChatPanel component.");
    }
    const chat = spyOn(ChatPanel, "type").mockImplementation(
      ({ initialChannel }: ChatPanelProps) => (
        <div className="h-full bg-[#18181b] p-4 text-white">Chat preview for {initialChannel}</div>
      )
    );
    const channelReader = spyOn(discoveryReader.channels, "getByUsername").mockImplementation(
      async ({ username, platform }) => {
        const index = homeStreamFixtures.findIndex(
          (stream) => stream.channelName === username && stream.platform === platform
        );
        const stream = homeStreamFixtures[index];
        if (!stream) return { success: false, error: "Channel preview unavailable." };
        return {
          success: true,
          data: makeChannel(index, {
            id: stream.channelId,
            platform: stream.platform,
            username: stream.channelName,
            displayName: stream.channelDisplayName,
            avatarUrl: stream.channelAvatar,
            kickChannelId: `legacy-${stream.channelId}`,
            chatroomId: index + 1000,
            kickUserId: `user-${stream.channelId}`,
          }),
        };
      }
    );
    return () => {
      chat.mockRestore();
      channelReader.mockRestore();
    };
  },
  parameters: { layout: "fullscreen" },
  args: { streams: homeStreamFixtures.slice(0, 4), isLoading: false },
} satisfies Meta<typeof FeaturedStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Carousel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    if (window.matchMedia("(min-width: 1280px)").matches) {
      expect(
        await canvas.findByText(`Chat preview for ${homeStreamFixtures[0].channelName}`)
      ).toBeVisible();
    }
    expect(await canvas.findByText(homeStreamFixtures[0].channelDisplayName)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /next featured/i }));
    expect(await canvas.findByText(homeStreamFixtures[1].channelDisplayName)).toBeVisible();
    if (window.matchMedia("(min-width: 1280px)").matches) {
      expect(
        await canvas.findByText(`Chat preview for ${homeStreamFixtures[1].channelName}`)
      ).toBeVisible();
    }
  },
};
