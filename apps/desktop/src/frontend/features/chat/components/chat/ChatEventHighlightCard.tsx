import { useTranslation } from "react-i18next";
import type React from "react";
import { memo } from "react";
import type { ChatPlatform } from "../../../../../shared/chat-types";
import type { chatEn } from "@/i18n/locales/en/chat";

type ChatTranslationKey = `chat.${keyof typeof chatEn.chat}`;

type ChatEventHighlightCardProps = {
  children: React.ReactNode;
  accentColor: string;
  icon: React.ReactNode;
  platform: ChatPlatform;
  accentWidth?: number;
  style?: React.CSSProperties;
  testId: string;
} & ({ label: string; labelKey?: never } | { label?: never; labelKey: ChatTranslationKey });

export const ChatEventHighlightCard: React.FC<ChatEventHighlightCardProps> = memo(
  ({ children, accentColor, accentWidth = 3, icon, label, labelKey, platform, style, testId }) => {
    const { t } = useTranslation();
    const platformLabel = platform === "kick" ? "Kick" : "Twitch";
    const resolvedLabel = labelKey ? t(labelKey) : label;

    return (
      <div
        aria-label={t("chat.value0Value1Notice", { value0: platformLabel, value1: resolvedLabel })}
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
