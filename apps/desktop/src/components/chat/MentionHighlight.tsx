import type React from "react";
import { memo } from "react";
import { ChatHighlightCard } from "./ChatHighlightCard";

interface MentionHighlightProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const MentionHighlight: React.FC<MentionHighlightProps> = memo(({ children, style }) => {
  return (
    <ChatHighlightCard
      icon={
        <svg
          aria-hidden="true"
          className="h-5 w-5"
          fill="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            clipRule="evenodd"
            d="M14 4h-4a6 6 0 0 0-6 6v4a6 6 0 0 0 6 6h6v2h-6a8 8 0 0 1-8-8v-4a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8v3a4 4 0 0 1-7.13 2.49A4.5 4.5 0 0 1 7 12.5v-1a4.5 4.5 0 0 1 7-3.74V7h2v6a2 2 0 1 0 4 0v-3a6 6 0 0 0-6-6Zm0 7.5a2.5 2.5 0 0 0-5 0v1a2.5 2.5 0 0 0 5 0v-1Z"
            fillRule="evenodd"
          />
        </svg>
      }
      label="Mention"
      testId="viewer-mention-highlight"
      style={style}
    >
      {children}
    </ChatHighlightCard>
  );
});

MentionHighlight.displayName = "MentionHighlight";
