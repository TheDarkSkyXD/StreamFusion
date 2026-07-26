import type { Meta, StoryObj } from "@storybook/react-vite";

import { categoryFixtures } from "../../../.storybook/catalog-fixtures";
import { withAppRouter } from "../../../.storybook/story-router";
import { CategoryGrid } from "./category-grid";

const meta = {
  title: "Components/Discovery/CategoryGrid",
  component: CategoryGrid,
  decorators: [withAppRouter],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Responsive category collection with populated, loading, and empty states built into one presentational API.",
      },
    },
  },
  args: {
    categories: categoryFixtures.slice(0, 12),
    isLoading: false,
    emptyMessage: "No categories match these filters",
    skeletons: 12,
  },
} satisfies Meta<typeof CategoryGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Loading: Story = {
  args: {
    categories: undefined,
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    categories: [],
  },
};

export const CompactCollection: Story = {
  args: {
    categories: categoryFixtures.slice(0, 4),
    className: "lg:grid-cols-4",
  },
};
