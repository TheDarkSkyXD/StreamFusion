import type { Meta, StoryObj } from "@storybook/react-vite";

import { streamFixtures } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { StreamGrid } from "./stream-grid";

const meta = {
  title: "Components/Stream/StreamGrid",
  component: StreamGrid,
  decorators: [withAppRouter],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Responsive stream collection with progressive card mounting and first-class loading and empty states.",
      },
    },
  },
  args: {
    streams: streamFixtures.slice(0, 8),
    isLoading: false,
    skeletons: 8,
    emptyMessage: "No live streams match these filters",
  },
} satisfies Meta<typeof StreamGrid>;

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
  },
};
