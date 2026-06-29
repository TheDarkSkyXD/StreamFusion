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
        className="mx-2 my-2 min-w-0 max-w-full overflow-x-clip rounded-[6px] border border-[#333333] bg-[#1f1f24] text-[#efeff1]"
        data-testid={testId}
        style={{
          ...style,
          borderLeft: `1px solid ${accentColor}`,
        }}
      >
        <div className="flex min-w-0 items-start gap-2 px-3 py-2.5">
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"
            style={{ color: accentColor }}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold leading-4 text-[#a0a0a0]">
              <span>{label}</span>
              <span className="h-1 w-1 rounded-full bg-[#666666]" aria-hidden="true" />
              <span>{platformLabel}</span>
            </div>
            <div className="min-w-0 break-words text-[15px] font-semibold leading-[1.45] text-[#f4f4f5] [overflow-wrap:anywhere]">
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ChatEventHighlightCard.displayName = "ChatEventHighlightCard";
