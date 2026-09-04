import { Coins } from "lucide-react";
import type React from "react";
import { memo } from "react";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface KicksHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const KicksHighlight: React.FC<KicksHighlightProps> = memo(
  ({ children, platform, style }) => (
    <ChatEventHighlightCard
      accentColor="#53fc18"
      icon={<Coins aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} />}
      labelKey="chat.kicksSent"
      platform={platform}
      style={style}
      testId="kicks-highlight"
    >
      {children}
    </ChatEventHighlightCard>
  )
);

KicksHighlight.displayName = "KicksHighlight";
