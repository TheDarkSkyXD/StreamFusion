import type { Meta, StoryObj } from "@storybook/react-vite";

import { ResubHighlight } from "./ResubHighlight";

const meta = {
  title: "Components/Chat/Highlights/Resub",
  component: ResubHighlight,
  args: {
    platform: "twitch",
    children: (
      <span>
        <strong>NovaFriend</strong> subscribed for 24 months in a row!
      </span>
    ),
  },
} satisfies Meta<typeof ResubHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
