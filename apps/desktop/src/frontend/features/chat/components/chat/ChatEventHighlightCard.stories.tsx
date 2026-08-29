import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sparkles } from "lucide-react";

import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

const meta = {
  title: "Components/Chat/Primitives/ChatEventHighlightCard",
  component: ChatEventHighlightCard,
  args: {
    accentColor: "#a970ff",
    icon: <Sparkles className="h-4 w-4" aria-hidden="true" />,
    label: "Community event",
    platform: "twitch",
    testId: "storybook-event-highlight",
    children: (
      <span>
        <strong>NovaArcade</strong> unlocked a community moment.
      </span>
    ),
  },
} satisfies Meta<typeof ChatEventHighlightCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Twitch: Story = {};
export const Kick: Story = {
  args: { accentColor: "#53fc18", platform: "kick" },
};
