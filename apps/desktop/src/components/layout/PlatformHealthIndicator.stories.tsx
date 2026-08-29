import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { PlatformHealth, StatusPageDetail } from "@/backend/api/unified/platform-health";

import { PlatformHealthIndicator } from "./PlatformHealthIndicator";

interface HealthSnapshot {
  kick: PlatformHealth;
  twitch: PlatformHealth;
  details?: {
    kick?: StatusPageDetail;
    twitch?: StatusPageDetail;
  };
}

function withPlatformHealth(snapshot: HealthSnapshot): Decorator {
  return (Story) => {
    const baseBridge = window.electronAPI;
    const platformHealth = {
      get: async () => snapshot,
      onChange: () => () => undefined,
    };
    const storyBridge = new Proxy(baseBridge, {
      get(target, property, receiver) {
        if (property === "platformHealth") return platformHealth;
        return Reflect.get(target, property, receiver);
      },
    });
    Reflect.defineProperty(window, "electronAPI", {
      configurable: true,
      value: storyBridge,
    });
    return <Story />;
  };
}

const meta = {
  title: "Components/Layout/PlatformHealthIndicator",
  component: PlatformHealthIndicator,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Platform-specific service health messaging hydrated from a mocked Electron health snapshot.",
      },
    },
  },
} satisfies Meta<typeof PlatformHealthIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchDegraded: Story = {
  decorators: [withPlatformHealth({ kick: "healthy", twitch: "degraded" })],
};

export const KickStatusPageIncident: Story = {
  decorators: [
    withPlatformHealth({
      kick: "degraded",
      twitch: "healthy",
      details: {
        kick: {
          summary: "Kick is investigating delayed channel and stream updates.",
          impact: "minor",
        },
      },
    }),
  ],
};

export const BothUnreachable: Story = {
  decorators: [withPlatformHealth({ kick: "down", twitch: "down" })],
};

export const Healthy: Story = {
  decorators: [withPlatformHealth({ kick: "healthy", twitch: "healthy" })],
  parameters: {
    docs: {
      description: {
        story: "Healthy services intentionally render no banner.",
      },
    },
  },
};
