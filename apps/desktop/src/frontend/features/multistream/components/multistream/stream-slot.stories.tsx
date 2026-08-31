import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { installMultistreamMocks, resetMultistreamStore } from "./multistream-story-fixtures";
import { StreamSlot } from "./stream-slot";

const meta = {
  title: "Components/Multistream/Stream Slot",
  component: StreamSlot,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      installMultistreamMocks();
      resetMultistreamStore();
      return (
        <div className="aspect-video w-[min(50rem,90vw)] overflow-hidden rounded-lg bg-black">
          <Story />
        </div>
      );
    },
  ],
  args: {
    streamId: "twitch-novaarcade",
    platform: "twitch",
    channelName: "novaarcade",
    isMuted: false,
    onRemove: fn(),
    onFocus: fn(),
    isFocused: false,
  },
} satisfies Meta<typeof StreamSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offline: Story = {};

export const FocusedKick: Story = {
  args: {
    streamId: "kick-miramakes",
    platform: "kick",
    channelName: "miramakes",
    isMuted: true,
    isFocused: true,
  },
};

export const WithDragHandle: Story = {
  args: {
    dragHandleProps: {
      "aria-label": "Reorder NovaArcade",
    },
  },
};
