import type { Meta, StoryObj } from "@storybook/react-vite";

import { KicksHighlight } from "./KicksHighlight";

const meta = {
  title: "Components/Chat/Highlights/Kicks",
  component: KicksHighlight,
  args: {
    platform: "kick",
    children: (
      <span>
        <strong>KickViewer</strong> sent 2,500 KICKs: one more run!
      </span>
    ),
  },
} satisfies Meta<typeof KicksHighlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
