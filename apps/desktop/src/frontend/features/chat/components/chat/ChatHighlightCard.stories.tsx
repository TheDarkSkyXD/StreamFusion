import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageSquareText } from "lucide-react";

import { ChatHighlightCard } from "./ChatHighlightCard";

const meta = {
  title: "Components/Chat/Primitives/ChatHighlightCard",
  component: ChatHighlightCard,
  args: {
    icon: <MessageSquareText className="h-5 w-5" aria-hidden="true" />,
    label: "Highlighted Message",
    testId: "storybook-highlight-card",
    borderClassName: "border-[#9146ff]",
    children: (
      <div className="px-2 py-1.5 text-sm">
        <strong className="text-[#a970ff]">NovaFriend:</strong> A roomy card for a high-signal chat
        event.
      </div>
    ),
  },
} satisfies Meta<typeof ChatHighlightCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
