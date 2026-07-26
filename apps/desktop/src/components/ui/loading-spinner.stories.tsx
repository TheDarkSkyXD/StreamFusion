import type { Meta, StoryObj } from "@storybook/react-vite";

import { KickLoadingSpinner, LoadingSpinner, TwitchLoadingSpinner } from "./loading-spinner";

const meta = {
  title: "Components/UI/LoadingSpinner",
  component: LoadingSpinner,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  args: {
    size: "lg",
    color: "#ffffff",
  },
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    color: { control: "color" },
  },
} satisfies Meta<typeof LoadingSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-8">
      <div className="grid justify-items-center gap-2">
        <LoadingSpinner size="sm" />
        <span className="text-xs text-[var(--color-foreground-secondary)]">Small</span>
      </div>
      <div className="grid justify-items-center gap-2">
        <LoadingSpinner size="md" />
        <span className="text-xs text-[var(--color-foreground-secondary)]">Medium</span>
      </div>
      <div className="grid justify-items-center gap-2">
        <LoadingSpinner size="lg" />
        <span className="text-xs text-[var(--color-foreground-secondary)]">Large</span>
      </div>
    </div>
  ),
};

export const PlatformContext: Story = {
  render: () => (
    <div className="flex gap-10">
      <div className="grid justify-items-center gap-3">
        <TwitchLoadingSpinner size="md" />
        <span className="text-sm font-semibold">Twitch</span>
      </div>
      <div className="grid justify-items-center gap-3">
        <KickLoadingSpinner size="md" />
        <span className="text-sm font-semibold">Kick</span>
      </div>
    </div>
  ),
};
