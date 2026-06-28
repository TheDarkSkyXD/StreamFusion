import type React from "react";
import { memo } from "react";

interface ChatHighlightCardProps {
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  testId: string;
  style?: React.CSSProperties;
}

export const ChatHighlightCard: React.FC<ChatHighlightCardProps> = memo(
  ({ children, icon, label, testId, style }) => {
    return (
      <div
        className="mx-2 my-2 min-w-0 max-w-full overflow-x-clip rounded-[6px] border border-white text-[#efeff1]"
        data-testid={testId}
        style={style}
      >
        <div className="flex h-7 min-w-0 items-center rounded-t-[6px] bg-[#26262c] px-2 py-1">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#efeff1]">
            {icon}
          </span>
          <strong className="mx-1 text-sm font-semibold leading-[19.6px] text-[#efeff1]">
            {label}
          </strong>
        </div>
        <div className="mx-2 mb-2 mt-1 min-w-0 bg-[#18181b]">{children}</div>
      </div>
    );
  }
);

ChatHighlightCard.displayName = "ChatHighlightCard";
