import type { ReplyInfo } from "../../shared/chat-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { TwitchReplyArrowIcon } from "./ChatReplyButton";

const REPLY_BUBBLE_PATHS = [
  "M9 10h2v2H9v-2Zm6 0h-2v2h2v-2Z",
  "m12 22-3-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4l-3 3Zm-2.172-5L12 19.172 14.172 17H19V5H5v12h4.828Z",
] as const;

function formatReplyUser(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return "@unknown";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function TwitchReplyBubbleIcon({ className }: { className?: string }) {
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
      <path d={REPLY_BUBBLE_PATHS[0]} fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d={REPLY_BUBBLE_PATHS[1]} fill="currentColor" />
    </svg>
  );
}

export function ChatMessageReplyPreview({ reply }: { reply: ReplyInfo }) {
  const displayName = reply.parentDisplayName || reply.parentUsername;
  const body = reply.parentMessageBody.trim();

  return (
    <div
      data-testid="chat-message-reply-preview"
      className="mb-0.5 flex min-w-0 max-w-full items-center gap-1 text-[#d3d3d9]"
    >
      <TwitchReplyBubbleIcon className="h-4 w-4 shrink-0 text-[#d3d3d9]" />
      <p className="min-w-0 truncate text-sm font-normal leading-[1.4]">
        <span>Replying to </span>
        <span className="text-[#efeff1]">{formatReplyUser(displayName)}</span>
        {body ? <span>: {body}</span> : null}
      </p>
    </div>
  );
}

export function ChatComposerReplyPreview({
  displayName,
  content,
  onCancel,
}: {
  displayName: string;
  content: string;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="reply-preview"
      className="flex items-center gap-2 rounded-t-md border-b border-[var(--color-border)] bg-[#18181b] px-2 py-1 text-[#efeff1]"
    >
      <TwitchReplyArrowIcon className="h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-[1.35]">
          <span className="font-semibold">Replying to {formatReplyUser(displayName)}:</span>
        </div>
        {content ? (
          <p className="truncate text-xs leading-[1.35] text-[#adadb8]">{content}</p>
        ) : null}
      </div>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#adadb8] transition-colors duration-150 hover:bg-[rgba(83,83,95,0.48)] hover:text-[#efeff1] focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            aria-label="Cancel reply"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="m3.535 2.464 10 10-1.071 1.072-10-10 1.071-1.072Z" fill="currentColor" />
              <path d="m2.464 12.464 10-10 1.072 1.071-10 10-1.072-1.071Z" fill="currentColor" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Cancel reply</TooltipContent>
      </Tooltip>
    </div>
  );
}
