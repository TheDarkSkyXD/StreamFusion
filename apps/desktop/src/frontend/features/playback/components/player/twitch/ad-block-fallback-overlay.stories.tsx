import type { Meta, StoryObj } from "@storybook/react-vite";

import type { AdBlockStatus } from "@shared/adblock-types";

import { AdBlockFallbackOverlay } from "./ad-block-fallback-overlay";

const fallbackStatus: AdBlockStatus = {
  isActive: true,
  isShowingAd: true,
  isMidroll: true,
  isStrippingSegments: false,
  numStrippedSegments: 0,
  activePlayerType: null,
  channelName: "novaarcade",
  isUsingFallbackMode: true,
  adStartTime: Date.now() - 32_000,
};

const meta = {
  title: "Components/Player/Twitch/AdBlockFallbackOverlay",
  component: AdBlockFallbackOverlay,
  decorators: [
    (Story) => (
      <div className="relative flex aspect-video w-[800px] items-center justify-center overflow-hidden rounded-xl bg-black">
        <Story />
        <p className="max-w-md text-center text-sm text-white/60">
          Fallback UI is intentionally disabled. Ad blocking remains silent while playback recovery
          continues.
        </p>
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A preserved fallback boundary that intentionally renders no overlay, keeping ad recovery seamless.",
      },
    },
  },
  args: {
    status: fallbackStatus,
    channelName: "novaarcade",
  },
} satisfies Meta<typeof AdBlockFallbackOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FallbackModeSuppressed: Story = {};
