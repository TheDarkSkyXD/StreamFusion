import { Users } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface RaidHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

export const RaidHighlight: React.FC<RaidHighlightProps> = memo(({ children, platform, style }) => (
  <ChatEventHighlightCard
    accentColor="#38bdf8"
    icon={<Users aria-hidden="true" className="h-5 w-5" strokeWidth={2.3} />}
    labelKey="chat.raid"
    platform={platform}
    style={style}
    testId="raid-highlight"
  >
    {children}
  </ChatEventHighlightCard>
));

RaidHighlight.displayName = "RaidHighlight";
