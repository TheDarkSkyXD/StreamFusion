import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS,
  TWITCH_CHAT_ACTION_TOOLTIP_CLASS,
  TWITCH_MESSAGE_ACTION_CLASS,
} from "./ChatMessageActionStyles";

const PIN_PATHS = [
  "M18 4V2H6v2h2v5a3 3 0 0 0-3 3v4h14v-4a3 3 0 0 0-3-3V4h2Zm-1 10H7v-2a1 1 0 0 1 1-1h2V4h4v7h2a1 1 0 0 1 1 1v2Z",
  "M13 18h-2v4h2v-4Z",
] as const;

function TwitchPinIcon({ className }: { className?: string }) {
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
      <path fillRule="evenodd" clipRule="evenodd" d={PIN_PATHS[0]} fill="currentColor" />
      <path d={PIN_PATHS[1]} fill="currentColor" />
    </svg>
  );
}

export function ChatPinButton({ onClick }: { onClick: () => void }) {
  const label = "Pin this message";

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={TWITCH_MESSAGE_ACTION_CLASS}
          aria-label={label}
        >
          <div className="inline-flex h-5 w-5 items-center justify-center">
            <TwitchPinIcon className="h-5 w-5" />
          </div>
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
