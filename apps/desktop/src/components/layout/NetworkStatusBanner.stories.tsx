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
          "A bottom-left connectivity card that explains the outage and reports silent automatic reconnect progress.",
      },
    },
  },
  args: {
    isOnline: false,
    isChecking: false,
    retryInSeconds: 5,
  },
} satisfies Meta<typeof NetworkStatusBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OfflineCountdown: Story = {};

export const Checking: Story = {
  args: {
    isChecking: true,
    retryInSeconds: null,
  },
};

export const TheaterMode: Story = {
  args: {
    isTheaterModeActive: true,
  },
};

export const Online: Story = {
  args: {
    isOnline: true,
    isChecking: true,
    retryInSeconds: null,
  },
  parameters: {
    docs: {
      description: {
        story: "Online state intentionally renders no card or recovery toast.",
      },
    },
  },
};
