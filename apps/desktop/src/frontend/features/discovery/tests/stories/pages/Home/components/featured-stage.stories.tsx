import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withAppRouter } from "../../../../../../../../../.storybook/story-router";
import { FeaturedStage } from "../../../../../components/screens/Home/components/featured-stage";
import { homeStreamFixtures } from "../story-fixtures";

const meta = {
  title: "Pages/Home/FeaturedStage",
  component: FeaturedStage,
  decorators: [withAppRouter],
  parameters: { layout: "fullscreen" },
  args: { streams: homeStreamFixtures.slice(0, 4), isLoading: false },
} satisfies Meta<typeof FeaturedStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Carousel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByText(homeStreamFixtures[0].channelDisplayName)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /next featured/i }));
    expect(await canvas.findByText(homeStreamFixtures[1].channelDisplayName)).toBeVisible();
  },
};
