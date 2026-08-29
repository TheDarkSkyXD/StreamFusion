import type { Meta, StoryObj } from "@storybook/react-vite";

import { Skeleton } from "./skeleton";

const meta = {
  title: "Components/UI/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A motion-aware placeholder that reserves the final content's geometry and prevents layout shifts while data loads.",
      },
    },
  },
  args: {
    className: "h-24 w-80",
  },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const StreamCard: Story = {
  render: () => (
    <div className="w-80">
      <Skeleton className="aspect-video w-full rounded-lg" />
      <div className="mt-3 flex gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>
    </div>
  ),
};

export const ChannelList: Story = {
  render: () => (
    <div className="w-72 space-y-3">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="flex items-center gap-3" key={index}>
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  ),
};
