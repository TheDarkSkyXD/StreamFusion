import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../shared/chat-types";

interface ChatEventHighlightCardProps {
  children: React.ReactNode;
  accentColor: string;
  icon: React.ReactNode;
  label: string;
  platform: ChatPlatform;
  accentWidth?: number;
  style?: React.CSSProperties;
  testId: string;
}

export const ChatEventHighlightCard: React.FC<ChatEventHighlightCardProps> = memo(
  ({ children, accentColor, accentWidth = 3, icon, label, platform, style, testId }) => {
    const platformLabel = platform === "kick" ? "Kick" : "Twitch";

    return (
      <div
        aria-label={`${platformLabel} ${label} notice`}
        className="mx-1 my-1 min-w-0 max-w-full overflow-x-clip bg-[#1f1f24] text-[#efeff1]"
        data-testid={testId}
        style={{
          ...style,
          borderLeft: `${accentWidth}px solid ${accentColor}`,
        }}
      >
        <div className="flex min-w-0 items-start gap-2 px-3 py-1.5">
          <span
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[#efeff1]"
            style={{ color: accentColor }}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1 break-words text-sm font-bold leading-[18px] text-[#f4f4f5] [overflow-wrap:anywhere]">
            {children}
          </div>
        </div>
      </div>
    );
  }
);

ChatEventHighlightCard.displayName = "ChatEventHighlightCard";
