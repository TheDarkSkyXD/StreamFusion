import { MessageSquareText } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface HighlightedMessageHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const HighlightedMessageHighlight: React.FC<HighlightedMessageHighlightProps> = memo(
  ({ children, platform, style }) => (
    <ChatEventHighlightCard
      accentColor={platform === "kick" ? "#53fc18" : "#9146ff"}
      accentWidth={3}
      icon={<MessageSquareText aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />}
      label="Highlighted Message"
      platform={platform}
      style={style}
      testId="highlighted-message-highlight"
    >
      {children}
    </ChatEventHighlightCard>
  )
);

HighlightedMessageHighlight.displayName = "HighlightedMessageHighlight";
