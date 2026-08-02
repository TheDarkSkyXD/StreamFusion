import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useStreamRecordingState } from "@/hooks/use-stream-recording-state";
import {
  formatCapturedDuration,
  RECORDING_PHASE_LABELS,
} from "@/lib/stream-recording-presentation";
import { RecordingPauseResumeControl } from "./recording-session-control";
import { RecordingStopControl } from "./recording-stop-control";

export interface RecordingGlobalIndicatorProps {
  pauseControl?: ReactNode;
  resumeControl?: ReactNode;
  stopControl?: ReactNode;
}

export function RecordingGlobalIndicator({
  pauseControl,
  resumeControl,
  stopControl,
}: RecordingGlobalIndicatorProps) {
  const state = useStreamRecordingState();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const viewLinkRef = useRef<HTMLAnchorElement>(null);
  const active = state.active;

  useEffect(() => {
    if (!open) return;

    viewLinkRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (target instanceof Element && target.closest("[data-recording-stop-dialog]")) return;
      if (triggerRef.current?.contains(target) || detailsRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-recording-stop-dialog]")) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!active || state.phase === "interrupted") return null;

  const phaseLabel = RECORDING_PHASE_LABELS[state.phase];
  const capturedDuration = formatCapturedDuration(active.capturedDurationSeconds);
  const isWarning = ["preparing", "reconnecting", "paused"].includes(state.phase);
  const platformLabel = active.platform === "twitch" ? "Twitch" : "Kick";
  const gapSummary = active.gapCount
    ? `${active.gapCount} ${active.gapCount === 1 ? "gap" : "gaps"}${
        active.hasOpenGap ? " · current gap open" : ""
      }`
    : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Stream recording, ${phaseLabel}, ${active.channelName} on ${platformLabel}, ${capturedDuration} captured, show details`}
        aria-expanded={open}
        aria-controls={detailsId}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-3 text-xs font-bold text-white transition-colors hover:bg-[var(--color-background-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full motion-reduce:animate-none ${
            state.phase === "recording"
              ? "animate-pulse bg-[var(--color-storm-primary)]"
              : isWarning
                ? "bg-amber-400"
                : "bg-zinc-400"
          }`}
        />
        <span>{phaseLabel}</span>
        <span className="text-white/70">{capturedDuration}</span>
      </button>

      {open ? (
        <div
          ref={detailsRef}
          id={detailsId}
          role="dialog"
          aria-label="Recording details"
          className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-elevated)] p-3 text-left shadow-[0_4px_16px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-foreground-muted)]">
            Active recording
          </p>
          <p className="mt-1 truncate text-sm font-bold text-white">{active.title}</p>
          <p className="mt-1 text-xs font-semibold text-white/80">
            {active.channelName} · {platformLabel}
          </p>
          <p className="mt-1 text-xs text-[var(--color-foreground-muted)]">
            {capturedDuration} captured
            {active.qualityLabel ? ` · ${active.qualityLabel}` : ""}
          </p>
          {gapSummary ? (
            <p className="mt-1 text-xs text-amber-200">Current session: {gapSummary}</p>
          ) : null}
          {active.qualityChange ? (
            <p
              aria-hidden="true"
              data-quality-change-revision={active.qualityChange.revision}
              className="mt-1 text-xs font-semibold text-amber-200"
            >
              Quality changed {active.qualityChange.fromQuality} → {active.qualityChange.toQuality}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                ref={viewLinkRef}
                to="/stream/$platform/$channel"
                params={{ platform: active.platform, channel: active.channelName }}
                onClick={() => setOpen(false)}
              >
                View recording
              </Link>
            </Button>
            {state.phase === "paused"
              ? (resumeControl ?? <RecordingPauseResumeControl surface="global" />)
              : (pauseControl ?? <RecordingPauseResumeControl surface="global" />)}
            {stopControl ?? <RecordingStopControl surface="global" />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
