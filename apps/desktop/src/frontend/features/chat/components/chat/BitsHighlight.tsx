import { Gem } from "lucide-react";
import type React from "react";
import { memo } from "react";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface BitsHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const BitsHighlight: React.FC<BitsHighlightProps> = memo(({ children, platform, style }) => (
  <ChatEventHighlightCard
    accentColor="#a970ff"
    icon={<Gem aria-hidden="true" className="h-5 w-5" strokeWidth={2.3} />}
    labelKey="chat.bits"
    platform={platform}
    style={style}
    testId="bits-highlight"
  >
    {children}
  </ChatEventHighlightCard>
));

BitsHighlight.displayName = "BitsHighlight";
