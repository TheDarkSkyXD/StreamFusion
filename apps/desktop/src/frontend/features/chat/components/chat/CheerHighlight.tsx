import { Sparkles } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface CheerHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const CheerHighlight: React.FC<CheerHighlightProps> = memo(
  ({ children, platform, style }) => (
    <ChatEventHighlightCard
      accentColor="#c084fc"
      icon={<Sparkles aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />}
      labelKey="chat.cheer"
      platform={platform}
      style={style}
      testId="cheer-highlight"
    >
      {children}
    </ChatEventHighlightCard>
  )
);

CheerHighlight.displayName = "CheerHighlight";
