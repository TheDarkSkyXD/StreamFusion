import type { Meta, StoryObj } from "@storybook/react-vite";

import { SEVEN_TV_EMOTE } from "../chat-story-fixtures";
import { EmoteTooltip } from "./EmoteTooltip";

const meta = {
  title: "Components/Chat/Tooltips/Emote Tooltip",
  component: EmoteTooltip,
  parameters: { layout: "fullscreen" },
  args: {
    show: true,
    mousePos: { x: 180, y: 120 },
    emote: {
      ...SEVEN_TV_EMOTE,
      addedAt: Date.UTC(2023, 5, 22),
    },
  },
} satisfies Meta<typeof EmoteTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnimatedSevenTV: Story = {
  render: (args) => (
    <div className="min-h-[420px] bg-[#0f0f0f] p-8 text-sm text-neutral-400">
      Tooltip positioned near the synthetic pointer.
      <EmoteTooltip {...args} />
    </div>
  ),
};

export const Hidden: Story = {
  args: { show: false },
};
