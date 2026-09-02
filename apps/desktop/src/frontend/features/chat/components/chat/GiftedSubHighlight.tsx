import { Gift } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface GiftedSubHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const GiftedSubHighlight: React.FC<GiftedSubHighlightProps> = memo(
  ({ children, platform, style }) => (
    <ChatEventHighlightCard
      accentColor="#f472b6"
      icon={<Gift aria-hidden="true" className="h-5 w-5" strokeWidth={2.35} />}
      labelKey="chat.giftedSub"
      platform={platform}
      style={style}
      testId="gifted-sub-highlight"
    >
      {children}
    </ChatEventHighlightCard>
  )
);

GiftedSubHighlight.displayName = "GiftedSubHighlight";
