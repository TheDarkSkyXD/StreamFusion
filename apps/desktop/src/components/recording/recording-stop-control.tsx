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

export function RecordingStopControl({ surface }: { surface: "global" | "player" }) {
  const state = useStreamRecordingState();
  const { stop } = useStreamRecordingActions();
  const [open, setOpen] = useState(false);
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
    const result = await stop(active.sessionId);
    setPending(false);
    if (result.success) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && setOpen(nextOpen)}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Stop recording"
          data-recording-control-surface={surface}
          className="gap-1.5 motion-reduce:transition-none"
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
          <DialogTitle>Stop recording?</DialogTitle>
          <DialogDescription>
            StreamFusion will combine the captured sections into one playable file. Keep recording
            if you are not ready to finish.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={keepRecordingRef}
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Keep Recording
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={confirmStop}
          >
            {pending ? "Finalizing" : "Stop and Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
