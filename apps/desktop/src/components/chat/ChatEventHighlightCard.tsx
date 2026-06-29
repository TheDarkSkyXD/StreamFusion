import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../shared/chat-types";

interface ChatEventHighlightCardProps {
  children: React.ReactNode;
  accentColor: string;
  icon: React.ReactNode;
  label: string;
  platform: ChatPlatform;
  style?: React.CSSProperties;
  testId: string;
}

export const ChatEventHighlightCard: React.FC<ChatEventHighlightCardProps> = memo(
  ({ children, accentColor, icon, label, platform, style, testId }) => {
    const platformLabel = platform === "kick" ? "Kick" : "Twitch";

    return (
      <div
        aria-label={`${platformLabel} ${label} notice`}
        className="mx-1 my-1 min-w-0 max-w-full overflow-x-clip border border-[#333333] bg-[#1f1f24] text-[#efeff1]"
        data-testid={testId}
        style={{
          ...style,
          borderLeft: `1px solid ${accentColor}`,
        }}
      >
        <div className="flex min-w-0 items-start gap-3 px-3 py-2.5">
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[#efeff1]"
            style={{ color: accentColor }}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1 break-words text-[15px] font-medium leading-[1.45] text-[#f4f4f5] [overflow-wrap:anywhere]">
            {children}
          </div>
        </div>
      </div>
    );
  }
);

ChatEventHighlightCard.displayName = "ChatEventHighlightCard";
