import type { Meta, StoryObj } from "@storybook/react-vite";

import { homeStreamFixtures } from "../story-fixtures";
import { withAppRouter } from "../../../../.storybook/story-router";

import { LiveNowSection } from "./live-now-section";

const meta = {
  title: "Pages/Home/LiveNowSection",
  component: LiveNowSection,
  decorators: [withAppRouter],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Home-page live-channel collection, including its supported loading and empty fallbacks.",
      },
    },
  },
  args: {
    streams: homeStreamFixtures.slice(1, 9),
    isLoading: false,
  },
} satisfies Meta<typeof LiveNowSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Loading: Story = {
  args: {
    streams: undefined,
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    streams: [],
    isLoading: false,
  },
};
