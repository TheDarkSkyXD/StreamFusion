import type { Meta, StoryObj } from "@storybook/react-vite";

import { StreamVerifiedBadge } from "./stream-verified-badge";

const meta = {
  title: "Components/Stream/StreamVerifiedBadge",
  component: StreamVerifiedBadge,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Accessible platform verification mark. Twitch uses the native purple badge and Kick uses its bundled verified asset.",
      },
    },
  },
  args: {
    platform: "twitch",
    className: "h-5 w-5",
  },
  argTypes: {
    platform: { control: "inline-radio", options: ["twitch", "kick"] },
  },
} satisfies Meta<typeof StreamVerifiedBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const BothPlatforms: Story = {
  render: () => (
    <div className="flex gap-6 rounded-lg bg-[var(--color-background-secondary)] p-5">
      <span className="flex items-center gap-2 font-bold">
        NovaArcade
        <StreamVerifiedBadge platform="twitch" className="h-5 w-5" />
      </span>
      <span className="flex items-center gap-2 font-bold">
        RiftRunner
        <StreamVerifiedBadge platform="kick" className="h-5 w-5" />
      </span>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <StreamVerifiedBadge platform="twitch" className="h-3.5 w-3.5" />
      <StreamVerifiedBadge platform="twitch" className="h-5 w-5" />
      <StreamVerifiedBadge platform="twitch" className="h-8 w-8" />
    </div>
  ),
};
