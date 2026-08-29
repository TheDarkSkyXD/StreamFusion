import type { Meta, StoryObj } from "@storybook/react-vite";

import { SAFE_PLAYER_POSTER } from "./player-story-fixtures";
import { SeekPreview } from "./seek-preview";

const meta = {
  title: "Components/Player/SeekPreview",
  component: SeekPreview,
  decorators: [
    (Story) => (
      <div className="relative mt-48 h-4 w-[640px] rounded-full bg-white/20">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "centered" },
  args: {
    time: 1_522,
    position: 0.55,
    previewImage: SAFE_PLAYER_POSTER,
  },
} satisfies Meta<typeof SeekPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithThumbnail: Story = {};
export const TimestampOnly: Story = { args: { previewImage: undefined } };
export const LeftEdge: Story = { args: { position: 0.04 } };
export const RightEdge: Story = { args: { position: 0.96 } };
