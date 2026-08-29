import type { Meta, StoryObj } from "@storybook/react-vite";

import { CategoryCardSkeleton } from "./category-card-skeleton";

const meta = {
  title: "Components/Discovery/CategoryCardSkeleton",
  component: CategoryCardSkeleton,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Loading placeholder that reserves the same portrait-art and metadata geometry as a category card.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[220px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CategoryCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Grid: Story = {
  decorators: [
    (Story) => (
      <div className="grid w-[720px] grid-cols-3 gap-4">
        {Array.from({ length: 3 }, (_, index) => (
          <Story key={index} />
        ))}
      </div>
    ),
  ],
};
