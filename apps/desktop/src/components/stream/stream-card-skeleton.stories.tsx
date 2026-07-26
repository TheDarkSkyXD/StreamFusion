import type { Meta, StoryObj } from "@storybook/react-vite";

import { StreamCardSkeleton } from "./stream-card-skeleton";

const meta = {
  title: "Components/Stream/StreamCardSkeleton",
  component: StreamCardSkeleton,
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Loading placeholder that preserves the thumbnail, avatar, title, category, and tag geometry of a stream card.",
      },
    },
  },
} satisfies Meta<typeof StreamCardSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Row: Story = {
  decorators: [
    (Story) => (
      <div className="grid w-[1120px] grid-cols-3 gap-4">
        {Array.from({ length: 3 }, (_, index) => (
          <Story key={index} />
        ))}
      </div>
    ),
  ],
};
