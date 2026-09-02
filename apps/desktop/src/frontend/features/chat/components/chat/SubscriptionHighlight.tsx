import { Star } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface SubscriptionHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const SubscriptionHighlight: React.FC<SubscriptionHighlightProps> = memo(
  ({ children, platform, style }) => (
    <ChatEventHighlightCard
      accentColor="#f5c451"
      accentWidth={3}
      icon={<Star aria-hidden="true" className="h-4 w-4" fill="currentColor" strokeWidth={2.25} />}
      labelKey="chat.subscription"
      platform={platform}
      style={style}
      testId="subscription-highlight"
    >
      {children}
    </ChatEventHighlightCard>
  )
);

SubscriptionHighlight.displayName = "SubscriptionHighlight";
