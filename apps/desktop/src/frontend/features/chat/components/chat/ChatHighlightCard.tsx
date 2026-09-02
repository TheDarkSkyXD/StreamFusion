import type React from "react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { chatEn } from "@/i18n/locales/en/chat";

type ChatTranslationKey = `chat.${keyof typeof chatEn.chat}`;

type ChatHighlightCardProps = {
  children: React.ReactNode;
  icon: React.ReactNode;
  testId: string;
  borderClassName?: string;
  style?: React.CSSProperties;
} & ({ label: string; labelKey?: never } | { label?: never; labelKey: ChatTranslationKey });

export const ChatHighlightCard: React.FC<ChatHighlightCardProps> = memo(
  ({ children, icon, label, labelKey, testId, borderClassName = "border-white", style }) => {
    const { t } = useTranslation();
    const resolvedLabel = labelKey ? t(labelKey) : label;

    return (
      <div
        className={`mx-2 my-2 min-w-0 max-w-full overflow-x-clip rounded-[6px] border ${borderClassName} text-[#efeff1]`}
        data-testid={testId}
        style={style}
      >
        <div className="flex h-7 min-w-0 items-center rounded-t-[6px] bg-[#26262c] px-2 py-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#efeff1]">
            {icon}
          </span>
          <strong className="mx-1 text-sm font-semibold leading-[19.6px] text-[#efeff1]">
            {resolvedLabel}
          </strong>
        </div>
        <div className="mx-2 mb-2 mt-1 min-w-0 bg-[#18181b]">{children}</div>
      </div>
    );
  }
);

ChatHighlightCard.displayName = "ChatHighlightCard";
