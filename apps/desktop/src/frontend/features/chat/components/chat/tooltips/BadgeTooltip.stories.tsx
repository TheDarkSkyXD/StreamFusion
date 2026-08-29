import type { Meta, StoryObj } from "@storybook/react-vite";

import { TWITCH_BADGE } from "../chat-story-fixtures";
import { BadgeTooltip } from "./BadgeTooltip";

const meta = {
  title: "Components/Chat/Tooltips/Badge Tooltip",
  component: BadgeTooltip,
  parameters: { layout: "fullscreen" },
  args: {
    show: true,
    mousePos: { x: 180, y: 120 },
    badgeInfo: {
      src: TWITCH_BADGE.imageUrl,
      title: TWITCH_BADGE.title,
      platform: "Twitch",
      owner: { username: "NovaArcade" },
    },
  },
} satisfies Meta<typeof BadgeTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ModeratorBadge: Story = {
  render: (args) => (
    <div className="min-h-[360px] bg-[#0f0f0f] p-8 text-sm text-neutral-400">
      Tooltip positioned near the synthetic pointer.
      <BadgeTooltip {...args} />
    </div>
  ),
};

export const Hidden: Story = {
  args: { show: false },
};
