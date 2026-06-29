import { Trash2 } from "lucide-react";
import type React from "react";
import { memo } from "react";
import { ChatHighlightCard } from "./ChatHighlightCard";

interface DeletedMessageHighlightCozyProps {
  auditDetail?: React.ReactNode;
  content: React.ReactNode;
  deletedTime: string;
  mode: "message" | "compact" | "audit";
  moderator: React.ReactNode;
  sender: React.ReactNode;
  style?: React.CSSProperties;
}

export const DeletedMessageHighlightCozy: React.FC<DeletedMessageHighlightCozyProps> = memo(
  ({ auditDetail, content, deletedTime, mode, moderator, sender, style }) => {
    return (
      <ChatHighlightCard
        borderClassName="border-[#ff6b6b]"
        icon={<Trash2 className="h-5 w-5" strokeWidth={2.5} />}
        label="Deleted message"
        testId="deleted-message-highlight"
        style={style}
      >
        {mode === "message" ? (
          <div className="px-1 py-1 text-sm text-white">{content}</div>
        ) : (
          <div className="min-w-0 space-y-2 px-1 py-1">
            <div className="min-w-0 rounded-[4px] bg-[#1f1f24] px-2 py-1.5 align-bottom text-sm leading-[1.45]">
              {sender}
              <span className="ml-1 inline align-bottom break-words text-white [overflow-wrap:anywhere] [&_img]:align-bottom">
                {content}
              </span>
            </div>
            <div className="align-bottom text-xs font-normal leading-snug text-[#adadb8]">
              <span className="align-bottom">Deleted by </span>
              {moderator}
              <span className="align-bottom"> at {deletedTime}</span>
              {auditDetail}
            </div>
          </div>
        )}
      </ChatHighlightCard>
    );
  }
);

DeletedMessageHighlightCozy.displayName = "DeletedMessageHighlightCozy";
