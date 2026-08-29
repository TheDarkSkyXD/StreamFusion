import type { TimedTextError } from "./types";

interface CaptionErrorNoticeProps {
  error: TimedTextError | null;
  onRetry: () => void;
}

export function CaptionErrorNotice({ error, onRetry }: CaptionErrorNoticeProps) {
  if (!error) return null;

  return (
    <div
      role="status"
      aria-label="Caption error"
      className="absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-[#252525] px-4 py-2 text-sm text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
    >
      <span>{error.message}</span>
      <button
        type="button"
        className="rounded-md bg-white px-3 py-1.5 font-semibold text-[#0f0f0f] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        onClick={onRetry}
      >
        Retry captions
      </button>
    </div>
  );
}
