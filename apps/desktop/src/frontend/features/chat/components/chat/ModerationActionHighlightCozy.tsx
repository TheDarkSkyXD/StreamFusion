import { useTranslation } from "react-i18next";
import { Ban } from "lucide-react";
import type React from "react";
import { memo } from "react";
import { ChatHighlightCard } from "./ChatHighlightCard";

interface ModerationActionHighlightCozyProps {
  actionLabel: "Timeout" | "Ban";
  deletedMessageCount: number;
  deletedMessages?: React.ReactNode;
  style?: React.CSSProperties;
  summary: React.ReactNode;
}

export const ModerationActionHighlightCozy: React.FC<ModerationActionHighlightCozyProps> = memo(
  ({ actionLabel, deletedMessageCount, deletedMessages, style, summary }) => {
    const { t } = useTranslation();
    return (
      <ChatHighlightCard
        borderClassName="border-[#f87171]"
        icon={<Ban className="h-5 w-5" strokeWidth={2.5} />}
        label={actionLabel}
        testId="moderation-action-highlight"
        style={style}
      >
        <div className="min-w-0 space-y-2 px-1 py-1">
          <div className="rounded-[4px] bg-[#1f1f24] px-2 py-1.5">{summary}</div>
          {deletedMessages && (
            <div
              className="min-w-0 rounded-[4px] border border-[#333333] bg-[#1f1f24] px-2 py-2 [&_img]:align-bottom [&_li]:align-bottom [&_li>span+span]:align-bottom [&_li>span:first-child]:items-end"
              data-testid="moderation-deleted-messages"
            >
              <div className="mb-1 align-bottom text-xs font-semibold uppercase tracking-normal text-[#adadb8]">
                {t("chat.deletedMessages")}
                {deletedMessageCount})
              </div>
              {deletedMessages}
            </div>
          )}
        </div>
      </ChatHighlightCard>
    );
  }
);

ModerationActionHighlightCozy.displayName = "ModerationActionHighlightCozy";
