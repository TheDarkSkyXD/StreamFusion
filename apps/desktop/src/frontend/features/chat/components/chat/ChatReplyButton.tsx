import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import {
  TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS,
  TWITCH_CHAT_ACTION_TOOLTIP_CLASS,
  TWITCH_MESSAGE_ACTION_CLASS,
} from "./ChatMessageActionStyles";

const REPLY_ARROW_PATH =
  "M7.828 12.207 11.621 16l-1.414 1.414L4 11.207 10.207 5l1.414 1.414-3.793 3.793h5.586a7 7 0 0 1 7 7v2h-2v-2a5 5 0 0 0-5-5H7.828Z";

export function TwitchReplyArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      focusable="false"
      aria-hidden="true"
      role="presentation"
      className={className}
    >
      <path fillRule="evenodd" clipRule="evenodd" d={REPLY_ARROW_PATH} fill="currentColor" />
    </svg>
  );
}

export function ChatReplyButton({ onClick }: { onClick: () => void }) {
  const label = "Click to reply";

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={TWITCH_MESSAGE_ACTION_CLASS}
          aria-label={label}
        >
          <TwitchReplyArrowIcon className="h-5 w-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        className={`${TWITCH_CHAT_ACTION_TOOLTIP_CLASS} text-left`}
        arrowClassName={TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
