import type { Meta, StoryObj } from "@storybook/react-vite";

import { NetworkStatusBanner } from "./NetworkStatusBanner";

const meta = {
  title: "Components/Layout/NetworkStatusBanner",
  component: NetworkStatusBanner,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A full-width connectivity warning that appears only while the desktop renderer is offline.",
      },
    },
  },
  args: {
    isOnline: false,
  },
} satisfies Meta<typeof NetworkStatusBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offline: Story = {};

export const Online: Story = {
  args: {
    isOnline: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Online state intentionally renders no banner.",
      },
    },
  },
};
