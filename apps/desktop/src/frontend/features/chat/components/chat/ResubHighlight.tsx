import { Repeat2 } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface ResubHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const ResubHighlight: React.FC<ResubHighlightProps> = memo(
  ({ children, platform, style }) => (
    <ChatEventHighlightCard
      accentColor="#f59e0b"
      icon={<Repeat2 aria-hidden="true" className="h-5 w-5" strokeWidth={2.4} />}
      labelKey="chat.resub"
      platform={platform}
      style={style}
      testId="resub-highlight"
    >
      {children}
    </ChatEventHighlightCard>
  )
);

ResubHighlight.displayName = "ResubHighlight";
