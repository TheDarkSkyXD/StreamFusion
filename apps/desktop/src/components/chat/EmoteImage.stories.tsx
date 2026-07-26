import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { KAPPA_EMOTE, SEVEN_TV_EMOTE } from "./chat-story-fixtures";
import { EmoteImage } from "./EmoteImage";

const meta = {
  title: "Components/Chat/MessageParts/EmoteImage",
  component: EmoteImage,
  parameters: { layout: "centered" },
  args: {
    emote: KAPPA_EMOTE,
    size: "large",
    lazyLoad: false,
    onClick: fn(),
  },
} satisfies Meta<typeof EmoteImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Animated: Story = {
  args: { emote: SEVEN_TV_EMOTE, size: "xlarge" },
};
export const DeferredSkeleton: Story = {
  args: {
    lazyLoad: true,
    showTooltip: false,
    onClick: undefined,
  },
};
export const Compact: Story = { args: { size: "small" } };
