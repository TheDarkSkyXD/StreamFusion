import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProxiedImage } from "./proxied-image";

const channelArtwork = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#1a1a1a"/>
    <rect x="24" y="24" width="592" height="312" rx="16" fill="#252525"/>
    <circle cx="320" cy="155" r="64" fill="#dc143c"/>
    <path d="m302 116 72 39-72 39z" fill="#fff"/>
    <text x="320" y="265" fill="#fff" text-anchor="middle" font-family="system-ui" font-size="28" font-weight="700">STREAM PREVIEW</text>
  </svg>
`)}`;

const meta = {
  title: "Components/UI/ProxiedImage",
  component: ProxiedImage,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "The shared image boundary for remote channel art. Kick and supported Twitch URLs are routed through Electron protocols; missing or failed images render a stable fallback.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[480px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg">
        <Story />
      </div>
    ),
  ],
  args: {
    src: channelArtwork,
    alt: "A StreamFusion stream preview",
    className: "aspect-video w-full object-cover",
    width: 640,
    height: 360,
    loading: "eager",
  },
  argTypes: {
    loading: {
      control: "inline-radio",
      options: ["lazy", "eager"],
    },
    fallback: { control: false },
  },
} satisfies Meta<typeof ProxiedImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const InitialFallback: Story = {
  args: {
    src: null,
    alt: "Nova",
    className: "aspect-video w-full",
  },
};

export const CustomFallback: Story = {
  args: {
    src: "",
    alt: "Unavailable artwork",
    fallback: (
      <div className="flex aspect-video items-center justify-center bg-[var(--color-background-tertiary)] text-sm font-semibold text-[var(--color-foreground-secondary)]">
        Preview unavailable
      </div>
    ),
  },
};

export const AvatarCrop: Story = {
  args: {
    alt: "Channel avatar",
    className: "mx-auto h-28 w-28 rounded-full object-cover",
    width: 112,
    height: 112,
  },
};
