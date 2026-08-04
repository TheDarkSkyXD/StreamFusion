import { useRef, useState } from "react";
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
import { useStreamRecordingActions } from "@/hooks/use-stream-recording-actions";
import { useStreamRecordingState } from "@/hooks/use-stream-recording-state";

const STOP_CONTROL_CLASS =
  "bg-slate-600 text-white hover:bg-slate-500 motion-reduce:transition-none";
const DISCARD_CONTROL_CLASS =
  "bg-red-800 text-white hover:bg-red-700 motion-reduce:transition-none";

export function RecordingStopControl({ surface }: { surface: "global" | "player" }) {
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
          aria-label="Stop recording"
          data-recording-control-surface={surface}
          className={`gap-1.5 ${STOP_CONTROL_CLASS}`}
        >
          <LuSquare aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
          Stop
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
            {confirmingDiscard ? "Permanently discard this recording?" : "Stop recording?"}
          </DialogTitle>
          <DialogDescription>
            {confirmingDiscard
              ? "This permanently deletes the current recording and cannot be undone."
              : "StreamFusion will combine the captured sections into one playable file. Keep recording if you are not ready to finish."}
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
            Keep Recording
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
              {pending ? "Discarding" : "Discard Forever"}
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
                Discard recording…
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                aria-busy={pending}
                onClick={confirmStop}
                className={STOP_CONTROL_CLASS}
              >
                {pending ? "Finalizing" : "Stop and Save"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
