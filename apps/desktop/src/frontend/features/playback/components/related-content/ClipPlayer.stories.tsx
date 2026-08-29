import type { Meta, StoryObj } from "@storybook/react-vite";

import { useVolumeStore } from "@/store/volume-store";

import { ClipPlayer } from "./ClipPlayer";

const meta = {
  title: "Components/Stream/Related Content/Clip Player",
  component: ClipPlayer,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => {
      useVolumeStore.setState({ volume: 72, isMuted: false });
      return (
        <div className="aspect-video w-[min(56rem,90vw)] overflow-hidden rounded-xl bg-black">
          <Story />
        </div>
      );
    },
  ],
  args: {
    src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    autoPlay: false,
  },
} satisfies Meta<typeof ClipPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paused: Story = {};

export const Muted: Story = {
  decorators: [
    (Story) => {
      useVolumeStore.setState({ volume: 45, isMuted: true });
      return <Story />;
    },
  ],
};
