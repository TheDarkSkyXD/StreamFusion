import type React from "react";
import { memo } from "react";
import { ImHammer2 } from "react-icons/im";
import type { ChatPlatform } from "../../shared/chat-types";
import { ChatHighlightCard } from "./ChatHighlightCard";

interface ModeratorHighlightProps {
  children: React.ReactNode;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}

const TwitchModeratorIcon: React.FC = () => (
  <svg
    aria-hidden="true"
    className="h-5 w-5"
    fill="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clipRule="evenodd"
      d="M15.504 2H22v6.496L10.35 17.35 12 19l-1.5 1.5-2.785-2.785L3.5 22 2 20.5l4.285-4.215L3.5 13.5 5 12l1.65 1.65L15.504 2ZM20 7.504 8.923 15.923l-.846-.846L16.496 4H20v3.504Z"
      fillRule="evenodd"
    />
  </svg>
);

const KickModeratorIcon: React.FC = () => (
  <ImHammer2 aria-hidden="true" className="h-5 w-5 -scale-x-100" />
);

export const ModeratorHighlight: React.FC<ModeratorHighlightProps> = memo(
  ({ children, platform, style }) => {
    const icon = platform === "kick" ? <KickModeratorIcon /> : <TwitchModeratorIcon />;

    return (
      <ChatHighlightCard
        borderClassName="border-[#00a865]"
        icon={icon}
        label="Moderator"
        testId="moderator-chat-highlight"
        style={style}
      >
        {children}
      </ChatHighlightCard>
    );
  }
);

ModeratorHighlight.displayName = "ModeratorHighlight";
