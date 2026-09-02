import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuCircle } from "react-icons/lu";

import { ActiveRecordingDialog } from "@/features/playback/components/active-recording-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RecordingSessionControls } from "@/features/media-library/components/recording/recording-session-control";
import { useStreamRecordingActions } from "@/features/media-library/data/use-stream-recording-actions";
import { useStreamRecordingState } from "@/features/media-library/data/use-stream-recording-state";
import { formatCapturedDuration } from "@/features/media-library/utils/stream-recording-presentation";
import type { Platform } from "@shared/auth-types";
import type { ActiveStreamRecording } from "@shared/stream-recording-types";

const RECORDING_QUALITIES = [
  { label: "Best available", value: { quality: "Source", isSource: true } },
  { label: "1080p", value: { quality: "1080p", height: 1080 } },
  { label: "720p", value: { quality: "720p", height: 720 } },
  { label: "480p", value: { quality: "480p", height: 480 } },
] as const;

interface StreamRecordingControlProps {
  platform: Platform;
  channelName: string;
  streamId: string;
  title: string;
  isPlayable: boolean;
}

export function StreamRecordingControl({
  platform,
  channelName,
  streamId,
  title,
  isPlayable,
}: StreamRecordingControlProps) {
  const { t } = useTranslation();
  const { start } = useStreamRecordingActions();
  const recordingState = useStreamRecordingState();
  const [pending, setPending] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [qualityIndex, setQualityIndex] = useState(0);
  const [blockedRecording, setBlockedRecording] = useState<ActiveStreamRecording | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const active = recordingState.active;
  const isCurrentStreamRecording =
    active?.platform === platform &&
    active.channelName.trim().toLowerCase() === channelName.trim().toLowerCase();

  if (isCurrentStreamRecording) {
    const detail = [
      t("mediaLibrary.capturedDuration", {
        duration: formatCapturedDuration(active.capturedDurationSeconds),
      }),
      active.qualityLabel,
    ]
      .filter(Boolean)
      .join(" / ");

    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span>{detail}</span>
        </div>
        <RecordingSessionControls surface="player" />
      </div>
    );
  }

  if (!isPlayable) return null;

  async function handleStart() {
    if (pending) return;
    setSetupOpen(false);
    setPending(true);
    try {
      const result = await start({
        platform,
        channelName,
        streamId,
        title,
        desiredQuality: RECORDING_QUALITIES[qualityIndex].value,
      });
      if (result?.outcome === "blocked") setBlockedRecording(result.activeRecording);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="destructive"
        aria-label={t("mediaLibrary.recordStream")}
        aria-busy={pending}
        disabled={pending}
        onClick={() => setSetupOpen(true)}
        className="gap-2 motion-reduce:transition-none"
      >
        <LuCircle aria-hidden="true" className="h-4 w-4 fill-current" />
        {pending ? t("mediaLibrary.startingRecording") : t("mediaLibrary.record")}
      </Button>
      <Dialog open={setupOpen} onOpenChange={(open) => !pending && setSetupOpen(open)}>
        <DialogContent
          className="border-[var(--color-border)] bg-[var(--color-background-elevated)] sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("mediaLibrary.recordChannel", { channel: channelName })}</DialogTitle>
            <DialogDescription>{t("mediaLibrary.chooseRecordingQuality")}</DialogDescription>
          </DialogHeader>
          <div
            role="radiogroup"
            aria-label={t("mediaLibrary.recordingQuality")}
            className="grid gap-2"
          >
            {RECORDING_QUALITIES.map((option, index) => {
              const selected = qualityIndex === index;
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setQualityIndex(index)}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                    selected
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-white"
                      : "border-[var(--color-border)] bg-[var(--color-background-secondary)] text-[var(--color-foreground-muted)] hover:text-white"
                  }`}
                >
                  <span className="font-semibold">{option.label}</span>
                  <span
                    aria-hidden="true"
                    className={`h-3 w-3 rounded-full border ${
                      selected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                        : "border-[var(--color-border)]"
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => setSetupOpen(false)}>
              {t("mediaLibrary.cancel")}
            </Button>
            <Button type="button" onClick={handleStart}>
              {t("mediaLibrary.chooseSaveLocation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ActiveRecordingDialog
        recording={blockedRecording}
        onClose={() => setBlockedRecording(null)}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
