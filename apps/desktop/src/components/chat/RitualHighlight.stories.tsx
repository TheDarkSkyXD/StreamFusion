import type { Meta, StoryObj } from "@storybook/react-vite";

import { RitualHighlight } from "./RitualHighlight";

const meta = {
  title: "Components/Chat/Highlights/Ritual",
  component: RitualHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>FirstNightHere</strong> is sharing a first-time chat ritual.
      </span>
    ),
  },
} satisfies Meta<typeof RitualHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
