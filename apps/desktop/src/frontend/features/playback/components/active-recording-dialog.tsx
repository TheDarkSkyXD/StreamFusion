import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import { LuRadio } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActiveStreamRecording } from "@shared/stream-recording-types";

interface ActiveRecordingDialogProps {
  recording: ActiveStreamRecording | null;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export function ActiveRecordingDialog({
  recording,
  onClose,
  returnFocusRef,
}: ActiveRecordingDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={recording !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="border-[var(--color-border)] bg-[var(--color-background-elevated)] sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
            <LuRadio className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="space-y-1.5">
            <DialogTitle>{t("playback.recordingAlreadyActive")}</DialogTitle>
            <DialogDescription>{t("playback.recordingAlreadyActiveDescription")}</DialogDescription>
          </div>
        </DialogHeader>

        {recording && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4">
            <p className="font-semibold text-white">{recording.channelName}</p>
            <p className="mt-1 text-sm text-[var(--color-foreground-muted)]">{recording.title}</p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <DialogClose asChild>
            <Button variant="outline">{t("playback.cancel")}</Button>
          </DialogClose>
          {recording && (
            <Button asChild>
              <Link
                to="/stream/$platform/$channel"
                params={{ platform: recording.platform, channel: recording.channelName }}
              >
                {t("playback.viewRecording")}
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
