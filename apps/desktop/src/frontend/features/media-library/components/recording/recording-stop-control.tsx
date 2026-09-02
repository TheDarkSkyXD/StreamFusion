import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuSquare } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useStreamRecordingActions } from "@/features/media-library/data/use-stream-recording-actions";
import { useStreamRecordingState } from "@/features/media-library/data/use-stream-recording-state";

const STOP_CONTROL_CLASS =
  "bg-slate-600 text-white hover:bg-slate-500 motion-reduce:transition-none";
const DISCARD_CONTROL_CLASS =
  "bg-red-800 text-white hover:bg-red-700 motion-reduce:transition-none";

export function RecordingStopControl({ surface }: { surface: "global" | "player" }) {
  const { t } = useTranslation();
  const state = useStreamRecordingState();
  const { stop, discard } = useStreamRecordingActions();
  const [open, setOpen] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [pending, setPending] = useState(false);
  const keepRecordingRef = useRef<HTMLButtonElement>(null);
  const active = state.active;

  if (
    !active?.sessionId ||
    (state.phase !== "preparing" &&
      state.phase !== "recording" &&
      state.phase !== "paused" &&
      state.phase !== "reconnecting")
  ) {
    return null;
  }

  async function confirmStop() {
    if (!active?.sessionId || pending) return;
    setPending(true);
    try {
      const result = await stop(active.sessionId);
      if (result.success) setOpen(false);
    } finally {
      setPending(false);
    }
  }

  async function confirmDiscard() {
    if (!active?.sessionId || pending) return;
    setPending(true);
    try {
      const result = await discard(active.sessionId);
      if (result.success) {
        setConfirmingDiscard(false);
        setOpen(false);
      }
    } finally {
      setPending(false);
    }
  }

  function keepRecording() {
    setConfirmingDiscard(false);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        setOpen(nextOpen);
        if (!nextOpen) setConfirmingDiscard(false);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("mediaLibrary.stopRecording")}
          data-recording-control-surface={surface}
          className={`gap-1.5 ${STOP_CONTROL_CLASS}`}
        >
          <LuSquare aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
          {t("mediaLibrary.stop")}
        </Button>
      </DialogTrigger>
      <DialogContent
        role="alertdialog"
        data-recording-stop-dialog
        portalContainer={
          document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : null
        }
        className="border-[var(--color-border)] bg-[var(--color-background-elevated)] shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] motion-reduce:duration-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keepRecordingRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {confirmingDiscard
              ? t("mediaLibrary.permanentlyDiscardRecording")
              : t("mediaLibrary.stopRecordingQuestion")}
          </DialogTitle>
          <DialogDescription>
            {confirmingDiscard
              ? t("mediaLibrary.discardDescription")
              : t("mediaLibrary.stopDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={keepRecordingRef}
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={keepRecording}
          >
            {t("mediaLibrary.keepRecording")}
          </Button>
          {confirmingDiscard ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              aria-busy={pending}
              onClick={confirmDiscard}
              className={DISCARD_CONTROL_CLASS}
            >
              {pending ? t("mediaLibrary.discarding") : t("mediaLibrary.discardForever")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirmingDiscard(true)}
                className={DISCARD_CONTROL_CLASS}
              >
                {t("mediaLibrary.discardRecording")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                aria-busy={pending}
                onClick={confirmStop}
                className={STOP_CONTROL_CLASS}
              >
                {pending ? t("mediaLibrary.finalizing") : t("mediaLibrary.stopAndSave")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
