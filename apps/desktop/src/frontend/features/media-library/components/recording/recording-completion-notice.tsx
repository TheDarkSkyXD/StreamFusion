import { LuFolderOpen, LuPlay, LuX } from "react-icons/lu";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Button } from "@/components/ui/button";
import { useStreamRecordingActions } from "@/features/media-library/data/use-stream-recording-actions";
import { useStreamRecordingState } from "@/features/media-library/data/use-stream-recording-state";
import type { StreamRecordingNotice } from "@shared/stream-recording-types";

function outcomeCopy(
  notice: StreamRecordingNotice,
  t: TFunction
): { title: string; detail: string } {
  if (notice.outcome === "completed") {
    return {
      title: notice.usedFallback
        ? t("mediaLibrary.recordingSavedFallback")
        : t("mediaLibrary.recordingSaved", {
            format: notice.outputFormat ? notice.outputFormat.toUpperCase() : "",
          }),
      detail: t("mediaLibrary.recordingSavedDetail", { title: notice.title }),
    };
  }
  if (notice.outcome === "partial") {
    return {
      title: t("mediaLibrary.partialRecordingSaved"),
      detail: notice.error ?? t("mediaLibrary.partialRecordingDetail", { title: notice.title }),
    };
  }
  return { title: t("mediaLibrary.recordingFailed"), detail: notice.error };
}

export function RecordingOutcomeNotice({ notice }: { notice: StreamRecordingNotice }) {
  const { t } = useTranslation();
  const { openCompleted, showCompleted, dismissNotice } = useStreamRecordingActions();
  if (notice.delivery !== "in-app") return null;

  const copy = outcomeCopy(notice, t);
  const hasOutput = notice.outcome !== "failed";
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-4 right-4 z-[70] w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-[var(--color-background-elevated)] p-3 text-sm text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)] motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">{copy.title}</p>
          <p className="mt-1 text-xs text-[var(--color-foreground-muted)]">{copy.detail}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("mediaLibrary.dismissRecordingNotice")}
          className="h-8 w-8 shrink-0 motion-reduce:transition-none"
          onClick={() => void dismissNotice(notice.sessionId)}
        >
          <LuX aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
      {hasOutput ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("mediaLibrary.openRecording")}
            className="gap-1.5 motion-reduce:transition-none"
            onClick={() => void openCompleted(notice.sessionId)}
          >
            <LuPlay aria-hidden="true" className="h-3.5 w-3.5" />
            {t("mediaLibrary.open")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("mediaLibrary.showRecordingInFolder")}
            className="gap-1.5 motion-reduce:transition-none"
            onClick={() => void showCompleted(notice.sessionId)}
          >
            <LuFolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
            {t("mediaLibrary.showInFolder")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function RecordingOutcomeBridge() {
  const state = useStreamRecordingState();
  return state.notice ? <RecordingOutcomeNotice notice={state.notice} /> : null;
}
