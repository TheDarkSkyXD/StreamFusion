import { useEffect, useRef, useState } from "react";
import { LuCircleAlert, LuCircleX, LuFileCheck2, LuPlay } from "react-icons/lu";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStreamRecordingActions } from "@/hooks/use-stream-recording-actions";
import { useStreamRecordingState } from "@/hooks/use-stream-recording-state";
import { formatCapturedDuration } from "@/lib/stream-recording-presentation";
import type { StreamRecordingRecoveryActionResult } from "@/shared/stream-recording-types";

type RecoveryAction = "resume" | "finalize" | "dismiss";
type ResumeUnavailableReason = "stream-unavailable" | "stream-changed";

export function RecordingRecoveryDialog() {
  const state = useStreamRecordingState();
  const { resumeInterrupted, finalizeInterrupted, dismissInterrupted } =
    useStreamRecordingActions();
  const [pending, setPending] = useState<RecoveryAction | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [resumeUnavailable, setResumeUnavailable] = useState<ResumeUnavailableReason | null>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const finalizeRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const keepRecoveryRef = useRef<HTMLButtonElement>(null);
  const confirmDismissRef = useRef<HTMLButtonElement>(null);
  const focusAfterPendingRef = useRef<HTMLButtonElement | null>(null);
  const restoreDismissFocusRef = useRef(false);
  const active = state.phase === "interrupted" ? state.active : null;
  const activeSessionId = active?.sessionId ?? null;
  const missingStreamIdentity =
    active?.recoveryResumeUnavailableReason === "missing-stream-identity";
  const finalizeOnly =
    active?.recoveryFinalizeOnly === true || active?.recoveryResumeEligible === false;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // biome-ignore lint/correctness/useExhaustiveDependencies: recovery-local UI state is keyed by the active session ID.
  useEffect(() => {
    setPending(null);
    setConfirmDismiss(false);
    setResumeUnavailable(null);
    focusAfterPendingRef.current = null;
    restoreDismissFocusRef.current = false;
  }, [activeSessionId]);

  useEffect(() => {
    if (confirmDismiss) keepRecoveryRef.current?.focus();
    else if (restoreDismissFocusRef.current) {
      restoreDismissFocusRef.current = false;
      dismissRef.current?.focus();
    }
  }, [confirmDismiss]);

  useEffect(() => {
    if (pending !== null || !focusAfterPendingRef.current) return;
    focusAfterPendingRef.current.focus();
    focusAfterPendingRef.current = null;
  }, [pending]);

  if (!active?.sessionId) return null;

  const platformLabel = active.platform === "twitch" ? "Twitch" : "Kick";
  const selectedQuality = active.desiredQualityLabel ?? active.qualityLabel ?? "Unknown";
  const currentQuality = active.currentQualityLabel ?? active.qualityLabel ?? "Unknown";
  const gapCount = active.gapCount ?? 0;

  async function runAction(action: RecoveryAction): Promise<void> {
    const sessionId = active?.sessionId;
    if (!sessionId || pending) return;
    setPending(action);
    let result: StreamRecordingRecoveryActionResult;
    try {
      result =
        action === "resume"
          ? await resumeInterrupted(sessionId)
          : action === "finalize"
            ? await finalizeInterrupted(sessionId)
            : await dismissInterrupted(sessionId);
    } catch (error) {
      result = {
        success: false,
        code: "bridge-error",
        error: error instanceof Error ? error.message : "Recording recovery failed",
      };
    } finally {
      if (activeSessionIdRef.current === sessionId) setPending(null);
    }
    if (activeSessionIdRef.current !== sessionId) return;
    if (result.success) return;
    if (
      action === "resume" &&
      (result.code === "stream-unavailable" || result.code === "stream-changed")
    ) {
      setResumeUnavailable(result.code);
      focusAfterPendingRef.current = finalizeRef.current;
    } else {
      focusAfterPendingRef.current =
        action === "finalize"
          ? finalizeRef.current
          : action === "dismiss"
            ? confirmDismissRef.current
            : resumeRef.current;
    }
  }

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        role="alertdialog"
        hideCloseButton
        className="border-[var(--color-border)] bg-[var(--color-background-elevated)] shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] motion-reduce:duration-0 sm:max-w-lg"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (finalizeOnly) finalizeRef.current?.focus();
          else resumeRef.current?.focus();
        }}
      >
        {confirmDismiss ? (
          <>
            <DialogHeader>
              <DialogTitle>Dismiss recording recovery?</DialogTitle>
              <DialogDescription>
                StreamFusion will forget this recovery prompt. Your captured section files will
                remain on disk and will not be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button
                ref={keepRecoveryRef}
                type="button"
                variant="secondary"
                disabled={pending !== null}
                onClick={() => {
                  restoreDismissFocusRef.current = true;
                  setConfirmDismiss(false);
                }}
              >
                Keep recovery
              </Button>
              <Button
                ref={confirmDismissRef}
                type="button"
                variant="destructive"
                disabled={pending !== null}
                aria-busy={pending === "dismiss"}
                onClick={() => void runAction("dismiss")}
              >
                {pending === "dismiss" ? "Dismissing" : "Dismiss recovery permanently"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
                <LuCircleAlert className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="space-y-1.5">
                <DialogTitle>Recording interrupted</DialogTitle>
                <DialogDescription>
                  {finalizeOnly
                    ? missingStreamIdentity
                      ? "StreamFusion found captured footage from an older session, but cannot verify that the same Stream is still live. Finalize the footage already saved."
                      : "StreamFusion found finalization work from your last session. Finish checking the partial recording already saved."
                    : "StreamFusion found captured footage from your last session. Check whether the same stream is available to resume, or finalize the footage already saved."}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)] p-4">
              <p className="truncate text-sm font-bold text-white">{active.title}</p>
              <p className="mt-1 text-xs font-semibold text-white/80">
                {active.channelName} · {platformLabel}
              </p>
              <dl className="mt-4 grid gap-2 text-xs">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--color-foreground-muted)]">Captured</dt>
                  <dd className="font-semibold text-white">
                    {formatCapturedDuration(active.capturedDurationSeconds)} captured
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--color-foreground-muted)]">Quality</dt>
                  <dd className="text-right font-semibold text-white">
                    {selectedQuality} selected · {currentQuality} current
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--color-foreground-muted)]">Gaps</dt>
                  <dd className="font-semibold text-amber-200">
                    {gapCount} {gapCount === 1 ? "gap" : "gaps"}
                    {active.hasOpenGap ? " · restart gap open" : ""}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {pending === "resume"
                ? "Checking stream availability"
                : pending === "finalize"
                  ? "Finalizing partial recording"
                  : resumeUnavailable === "stream-changed"
                    ? "A different Stream is live. Finalize the partial recording instead."
                    : resumeUnavailable === "stream-unavailable"
                      ? "Stream unavailable. Finalize the partial recording instead."
                      : ""}
            </p>

            {resumeUnavailable ? (
              <p className="text-sm font-semibold text-amber-200">
                {resumeUnavailable === "stream-changed"
                  ? "A different Stream is now live on this Channel. It will not be appended to your captured footage; finalize the partial recording instead."
                  : "Stream unavailable. Your captured footage is safe; finalize the partial recording instead."}
              </p>
            ) : null}

            {finalizeOnly ? (
              <p className="text-sm font-semibold text-amber-200">
                {missingStreamIdentity
                  ? "This recovery has no stable Stream identity. Use Finalize Partial to safely finish the saved recording."
                  : "Finalization already started. Use Finalize Partial to safely finish the saved recording."}
              </p>
            ) : null}

            <DialogFooter className="flex-wrap gap-2 sm:space-x-0">
              <Button
                ref={dismissRef}
                type="button"
                variant="ghost"
                disabled={pending !== null}
                className="mr-auto gap-1.5"
                onClick={() => setConfirmDismiss(true)}
              >
                <LuCircleX className="h-4 w-4" aria-hidden="true" />
                Dismiss recovery
              </Button>
              <Button
                ref={finalizeRef}
                type="button"
                variant="outline"
                disabled={pending !== null}
                aria-busy={pending === "finalize"}
                className="gap-1.5"
                onClick={() => void runAction("finalize")}
              >
                <LuFileCheck2 className="h-4 w-4" aria-hidden="true" />
                {pending === "finalize" ? "Finalizing" : "Finalize Partial"}
              </Button>
              {finalizeOnly ? null : (
                <Button
                  ref={resumeRef}
                  type="button"
                  disabled={pending !== null || resumeUnavailable !== null}
                  aria-busy={pending === "resume"}
                  aria-label="Check stream and resume recording"
                  className="gap-1.5"
                  onClick={() => void runAction("resume")}
                >
                  <LuPlay className="h-4 w-4" aria-hidden="true" />
                  {pending === "resume"
                    ? "Checking"
                    : resumeUnavailable
                      ? resumeUnavailable === "stream-changed"
                        ? "Different Stream"
                        : "Stream Unavailable"
                      : "Check & Resume"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
