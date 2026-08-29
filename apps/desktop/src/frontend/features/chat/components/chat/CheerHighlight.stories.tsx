import type { Meta, StoryObj } from "@storybook/react-vite";

import { CheerHighlight } from "./CheerHighlight";

const meta = {
  title: "Components/Chat/Highlights/Cheer",
  component: CheerHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>MiraMakes</strong> sent a sparkling cheer for the final round.
      </span>
    ),
  },
} satisfies Meta<typeof CheerHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
