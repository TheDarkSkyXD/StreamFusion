import { useEffect, useRef, useState } from "react";
import { LuPause, LuPlay } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import { useStreamRecordingActions } from "@/hooks/use-stream-recording-actions";
import { useStreamRecordingState } from "@/hooks/use-stream-recording-state";
import type { StreamRecordingStatus } from "@/shared/stream-recording-types";
import { RecordingStopControl } from "./recording-stop-control";

export function RecordingSessionControls({ surface }: { surface: "global" | "player" }) {
  return (
    <div className="flex items-center gap-2">
      <RecordingPauseResumeControl surface={surface} />
      <RecordingStopControl surface={surface} />
    </div>
  );
}

export function RecordingPauseResumeControl({ surface }: { surface: "global" | "player" }) {
  const state = useStreamRecordingState();
  const { pause, resume } = useStreamRecordingActions();
  const [pending, setPending] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusWhenPhaseRef = useRef<StreamRecordingStatus | null>(null);
  const active = state.active;
  const isResuming = state.phase === "preparing" && active?.statusMessage === "Resuming";
  const isPaused = state.phase === "paused" || isResuming;

  useEffect(() => {
    if (focusWhenPhaseRef.current !== state.phase) return;
    focusWhenPhaseRef.current = null;
    buttonRef.current?.focus();
  }, [state.phase]);

  if (
    !active?.sessionId ||
    (state.phase !== "recording" && state.phase !== "paused" && !isResuming)
  ) {
    return null;
  }

  const label = isPaused ? "Resume recording" : "Pause recording";
  const Icon = isPaused ? LuPlay : LuPause;

  async function handleClick() {
    if (!active?.sessionId || pending || isResuming) return;
    setPending(true);
    focusWhenPhaseRef.current = isPaused ? "recording" : "paused";
    const result = isPaused ? await resume(active.sessionId) : await pause(active.sessionId);
    setPending(false);
    if (!result.success) {
      focusWhenPhaseRef.current = null;
      buttonRef.current?.focus();
    }
  }

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      aria-busy={pending || isResuming}
      disabled={pending || isResuming}
      data-recording-control-surface={surface}
      onClick={handleClick}
      className="gap-1.5 motion-reduce:transition-none"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {pending || isResuming ? (isPaused ? "Resuming" : "Pausing") : isPaused ? "Resume" : "Pause"}
    </Button>
  );
}
