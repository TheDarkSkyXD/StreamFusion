import { Ban } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface ModerationActionHighlightCompactProps {
  actionLabel: "Timeout" | "Ban";
  deletedMessageCount: number;
  deletedMessages?: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
  summary: React.ReactNode;
}

export const ModerationActionHighlightCompact: React.FC<ModerationActionHighlightCompactProps> =
  memo(({ actionLabel, deletedMessageCount, deletedMessages, platform, style, summary }) => {
    return (
      <ChatEventHighlightCard
        accentColor="#f87171"
        icon={<Ban className="h-4 w-4" strokeWidth={2.5} />}
        label={actionLabel}
        platform={platform}
        style={style}
        testId="moderation-action-highlight"
      >
        <div className="min-w-0 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-normal text-[#ffb4b4]">
            {actionLabel}
          </div>
          {summary}
          {deletedMessages && (
            <div
              className="min-w-0 border-l border-[#f87171]/40 pl-2"
              data-testid="moderation-deleted-messages"
            >
              <div className="mb-1 text-xs font-semibold uppercase tracking-normal text-[#adadb8]">
                Deleted messages ({deletedMessageCount})
              </div>
              {deletedMessages}
            </div>
          )}
        </div>
      </ChatEventHighlightCard>
    );
  });

ModerationActionHighlightCompact.displayName = "ModerationActionHighlightCompact";
