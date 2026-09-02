import { i18n } from "@/i18n";
import { Trash2 } from "lucide-react";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import { ChatEventHighlightCard } from "./ChatEventHighlightCard";

interface DeletedMessageHighlightCompactProps {
  auditDetail?: React.ReactNode;
  content: React.ReactNode;
  deletedTime: string;
  mode: "message" | "compact" | "audit";
  moderator: React.ReactNode;
  platform: ChatPlatform;
  sender: React.ReactNode;
  style?: React.CSSProperties;
}

export const DeletedMessageHighlightCompact: React.FC<DeletedMessageHighlightCompactProps> = memo(
  ({ auditDetail, content, deletedTime, mode, moderator, platform, sender, style }) => {
    return (
      <ChatEventHighlightCard
        accentColor="#ff6b6b"
        icon={<Trash2 className="h-4 w-4" strokeWidth={2.5} />}
        label="Deleted message"
        platform={platform}
        style={style}
        testId="deleted-message-highlight"
      >
        {mode === "message" ? (
          <div className="inline min-w-0 max-w-full break-words text-white [overflow-wrap:anywhere]">
            {content}
          </div>
        ) : (
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-semibold uppercase tracking-normal text-[#ffb4b4]">
              {i18n.t("chat.deletedMessage")}
            </div>
            <div className="min-w-0 align-bottom text-sm leading-[1.45]">
              {sender}
              <span className="ml-1 inline align-bottom break-words text-white [overflow-wrap:anywhere] [&_img]:align-bottom">
                {content}
              </span>
            </div>
            <div className="align-bottom text-xs font-normal leading-snug text-[#adadb8]">
              <span className="align-bottom">{i18n.t("chat.deletedBy")}</span>
              {moderator}
              <span className="align-bottom">
                {" "}
                {i18n.t("chat.at")}
                {deletedTime}
              </span>
              {auditDetail}
            </div>
          </div>
        )}
      </ChatEventHighlightCard>
    );
  }
);

DeletedMessageHighlightCompact.displayName = "DeletedMessageHighlightCompact";
