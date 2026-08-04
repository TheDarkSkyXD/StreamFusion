import { useEffect, useRef, useState } from "react";
import { LuPause, LuPlay } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import { useStreamRecordingActions } from "@/hooks/use-stream-recording-actions";
import { useStreamRecordingState } from "@/hooks/use-stream-recording-state";
import type { StreamRecordingStatus } from "@/shared/stream-recording-types";
import { RecordingStopControl } from "./recording-stop-control";

const PAUSE_CONTROL_CLASS = "bg-amber-400 text-black hover:bg-amber-300";
const RESUME_CONTROL_CLASS = "bg-green-500 text-black hover:bg-green-400";

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
  const isPausing = state.phase === "paused" && active?.statusMessage === "Pausing";
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

  const label = isPausing ? "Pausing recording" : isPaused ? "Resume recording" : "Pause recording";
  const Icon = isPaused && !isPausing ? LuPlay : LuPause;
  const buttonText = isPausing
    ? "Pausing"
    : pending || isResuming
      ? isPaused
        ? "Resuming"
        : "Pausing"
      : isPaused
        ? "Resume"
        : "Pause";

  async function handleClick() {
    if (!active?.sessionId || pending || isResuming || isPausing) return;
    setPending(true);
    focusWhenPhaseRef.current = isPaused ? "recording" : "paused";
    try {
      const result = isPaused ? await resume(active.sessionId) : await pause(active.sessionId);
      if (!result.success) {
        focusWhenPhaseRef.current = null;
        buttonRef.current?.focus();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      aria-busy={pending || isResuming || isPausing}
      disabled={pending || isResuming || isPausing}
      data-recording-control-surface={surface}
      onClick={handleClick}
      className={`gap-1.5 motion-reduce:transition-none ${
        !isPaused || isPausing ? PAUSE_CONTROL_CLASS : RESUME_CONTROL_CLASS
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {buttonText}
    </Button>
  );
}
