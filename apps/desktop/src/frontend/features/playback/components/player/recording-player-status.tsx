import { useStreamRecordingState } from "@/features/media-library/data/use-stream-recording-state";
import { useTranslation } from "react-i18next";
import {
  formatCapturedDuration,
  RECORDING_PHASE_LABEL_KEYS,
} from "@/features/media-library/utils/stream-recording-presentation";
import type { Platform } from "@shared/auth-types";

export interface RecordingPlayerStatusProps {
  platform: Platform;
  channelName: string;
  mode: "normal" | "theater" | "fullscreen";
}

export function RecordingPlayerStatus({ platform, channelName, mode }: RecordingPlayerStatusProps) {
  const { t } = useTranslation();
  const state = useStreamRecordingState();
  const active = state.active;
  if (
    !active ||
    active.platform !== platform ||
    active.channelName.toLowerCase() !== channelName.toLowerCase()
  ) {
    return null;
  }

  const isWarning = ["preparing", "reconnecting", "paused", "interrupted"].includes(state.phase);
  const gapSummary = active.gapCount
    ? t("playback.gapSummary", {
        count: active.gapCount,
        suffix: active.hasOpenGap ? t("playback.currentGapOpen") : "",
      })
    : null;
  return (
    <div
      data-mode={mode}
      className={`pointer-events-none absolute right-4 top-4 z-40 inline-flex min-h-8 items-center gap-2 rounded-full border border-white/15 bg-black/90 px-3 text-xs font-bold text-white ${
        isWarning ? "text-amber-200" : ""
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full motion-reduce:animate-none ${
          state.phase === "recording"
            ? "animate-pulse bg-[var(--color-storm-primary)]"
            : isWarning
              ? "bg-amber-400"
              : "bg-zinc-400"
        }`}
      />
      <span>
        {t(RECORDING_PHASE_LABEL_KEYS[state.phase])}{" "}
        {t("playback.capturedDuration", {
          duration: formatCapturedDuration(active.capturedDurationSeconds),
        })}
      </span>
      {active.qualityLabel && (
        <span className="border-l border-white/20 pl-2 text-white/70">{active.qualityLabel}</span>
      )}
      {active.qualityChange ? (
        <span
          aria-hidden="true"
          data-quality-change-revision={active.qualityChange.revision}
          className="border-l border-white/20 pl-2 text-amber-200"
        >
          {t("playback.qualityChanged", {
            from: active.qualityChange.fromQuality,
            to: active.qualityChange.toQuality,
          })}
        </span>
      ) : null}
      {gapSummary ? <span className="border-l border-white/20 pl-2">{gapSummary}</span> : null}
    </div>
  );
}
