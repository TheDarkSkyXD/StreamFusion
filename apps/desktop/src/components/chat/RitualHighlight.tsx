import { Crown } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface RitualHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const RitualHighlight: React.FC<RitualHighlightProps> = memo(
  ({ children, platform, style }) => (
    <ChatEventHighlightCard
      accentColor="#fb7185"
      icon={<Crown aria-hidden="true" className="h-5 w-5" strokeWidth={2.2} />}
      label="Ritual"
      platform={platform}
      style={style}
      testId="ritual-highlight"
    >
      {children}
    </ChatEventHighlightCard>
  )
);

RitualHighlight.displayName = "RitualHighlight";
