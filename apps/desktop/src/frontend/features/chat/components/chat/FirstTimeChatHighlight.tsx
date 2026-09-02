import type React from "react";
import { memo } from "react";
import { ChatHighlightCard } from "./ChatHighlightCard";

interface FirstTimeChatHighlightProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const TwitchFirstTimeChatIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    className="h-5 w-5"
    fill="currentColor"
    viewBox="0 0 20 20"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M8.75 3.25 10.5 7.5l4.25 1.75-4.25 1.75-1.75 4.25L7 11 2.75 9.25 7 7.5l1.75-4.25Z" />
    <path d="M15.5 1.75 16.25 3.5 18 4.25 16.25 5 15.5 6.75 14.75 5 13 4.25l1.75-.75.75-1.75Z" />
  </svg>
);

export const FirstTimeChatHighlight: React.FC<FirstTimeChatHighlightProps> = memo(
  ({ children, style }) => {
    return (
      <ChatHighlightCard
        icon={<TwitchFirstTimeChatIcon />}
        labelKey="chat.firstTimeChat"
        testId="first-time-chat-highlight"
        style={style}
      >
        {children}
      </ChatHighlightCard>
    );
  }
);

FirstTimeChatHighlight.displayName = "FirstTimeChatHighlight";
