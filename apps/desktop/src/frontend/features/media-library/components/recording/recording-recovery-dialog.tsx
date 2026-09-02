import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useStreamRecordingActions } from "@/features/media-library/data/use-stream-recording-actions";
import { useStreamRecordingState } from "@/features/media-library/data/use-stream-recording-state";
import { formatCapturedDuration } from "@/features/media-library/utils/stream-recording-presentation";
import type { StreamRecordingRecoveryActionResult } from "@shared/stream-recording-types";

type RecoveryAction = "resume" | "finalize" | "dismiss";
type ResumeUnavailableReason = "stream-unavailable" | "stream-changed";

export function RecordingRecoveryDialog() {
  const { t } = useTranslation();
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
  useLayoutEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

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
        error: error instanceof Error ? error.message : t("mediaLibrary.recordingRecoveryFailed"),
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
              <DialogTitle>{t("mediaLibrary.dismissRecordingRecovery")}</DialogTitle>
              <DialogDescription>{t("mediaLibrary.dismissRecoveryDescription")}</DialogDescription>
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
                {t("mediaLibrary.keepRecovery")}
              </Button>
              <Button
                ref={confirmDismissRef}
                type="button"
                variant="destructive"
                disabled={pending !== null}
                aria-busy={pending === "dismiss"}
                onClick={() => void runAction("dismiss")}
              >
                {pending === "dismiss"
                  ? t("mediaLibrary.dismissing")
                  : t("mediaLibrary.dismissRecoveryPermanently")}
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
                <DialogTitle>{t("mediaLibrary.recordingInterrupted")}</DialogTitle>
                <DialogDescription>
                  {finalizeOnly
                    ? missingStreamIdentity
                      ? t("mediaLibrary.recoveryOldSession")
                      : t("mediaLibrary.recoveryFinalizationWork")
                    : t("mediaLibrary.recoveryLastSession")}
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
                  <dt className="text-[var(--color-foreground-muted)]">
                    {t("mediaLibrary.captured")}
                  </dt>
                  <dd className="font-semibold text-white">
                    {t("mediaLibrary.capturedDuration", {
                      duration: formatCapturedDuration(active.capturedDurationSeconds),
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--color-foreground-muted)]">
                    {t("mediaLibrary.quality")}
                  </dt>
                  <dd className="text-right font-semibold text-white">
                    {t("mediaLibrary.qualitySelectedCurrent", {
                      selected: selectedQuality,
                      current: currentQuality,
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--color-foreground-muted)]">{t("mediaLibrary.gaps")}</dt>
                  <dd className="font-semibold text-amber-200">
                    {t("mediaLibrary.gapCount", {
                      count: gapCount,
                      suffix: active.hasOpenGap ? t("mediaLibrary.restartGapOpen") : "",
                    })}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {pending === "resume"
                ? t("mediaLibrary.checkingStreamAvailability")
                : pending === "finalize"
                  ? t("mediaLibrary.finalizingPartialRecording")
                  : resumeUnavailable === "stream-changed"
                    ? t("mediaLibrary.differentStreamLive")
                    : resumeUnavailable === "stream-unavailable"
                      ? t("mediaLibrary.streamUnavailableFinalize")
                      : ""}
            </p>

            {resumeUnavailable ? (
              <p className="text-sm font-semibold text-amber-200">
                {resumeUnavailable === "stream-changed"
                  ? t("mediaLibrary.differentStreamNotice")
                  : t("mediaLibrary.streamUnavailableNotice")}
              </p>
            ) : null}

            {finalizeOnly ? (
              <p className="text-sm font-semibold text-amber-200">
                {missingStreamIdentity
                  ? t("mediaLibrary.missingStreamIdentityNotice")
                  : t("mediaLibrary.finalizationStartedNotice")}
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
                {t("mediaLibrary.dismissRecovery")}
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
                {pending === "finalize"
                  ? t("mediaLibrary.finalizing")
                  : t("mediaLibrary.finalizePartial")}
              </Button>
              {finalizeOnly ? null : (
                <Button
                  ref={resumeRef}
                  type="button"
                  disabled={pending !== null || resumeUnavailable !== null}
                  aria-busy={pending === "resume"}
                  aria-label={t("mediaLibrary.checkStreamResume")}
                  className="gap-1.5"
                  onClick={() => void runAction("resume")}
                >
                  <LuPlay className="h-4 w-4" aria-hidden="true" />
                  {pending === "resume"
                    ? t("mediaLibrary.checking")
                    : resumeUnavailable
                      ? resumeUnavailable === "stream-changed"
                        ? t("mediaLibrary.differentStream")
                        : t("mediaLibrary.streamUnavailable")
                      : t("mediaLibrary.checkAndResume")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
