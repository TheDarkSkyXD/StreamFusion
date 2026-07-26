import type { Meta, StoryObj } from "@storybook/react-vite";

import { categoryFixtures } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { VirtualizedCategoryGrid } from "./virtualized-category-grid";

const meta = {
  title: "Components/Discovery/VirtualizedCategoryGrid",
  component: VirtualizedCategoryGrid,
  decorators: [withAppRouter],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Windowed category browser for large datasets. Scroll the canvas to inspect progressive rendering and the next-page reserve.",
      },
    },
  },
  args: {
    categories: categoryFixtures,
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    rowHeight: 310,
    overscan: 2,
    skeletonCount: 8,
    emptyMessage: "No categories match these filters",
    className: "px-4",
  },
} satisfies Meta<typeof VirtualizedCategoryGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Loading: Story = {
  args: {
    categories: [],
    isLoading: true,
  },
};

export const FetchingNextPage: Story = {
  args: {
    isFetchingNextPage: true,
    hasNextPage: true,
  },
};

export const Empty: Story = {
  args: {
    categories: [],
  },
};
