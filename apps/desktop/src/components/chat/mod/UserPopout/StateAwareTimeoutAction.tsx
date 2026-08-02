import { AlertCircle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModActionConfirmDialog } from "@/components/chat/mod/ModActionConfirmDialog";
import { showModActionSuccessToast } from "@/components/chat/mod/mod-action-toast";
import { TimeoutDurationPicker } from "@/components/chat/mod/TimeoutDurationPicker";
import type {
  TimeoutActionBinding,
  TimeoutSnapshotResult,
  TimeoutSubmitResult,
} from "@/shared/timeout-moderation-types";

interface StateAwareTimeoutActionProps {
  binding: TimeoutActionBinding;
  displayName: string;
  onPendingChange: (pending: boolean) => void;
  onSuccess: () => void | Promise<void>;
  presentation?: "trigger" | "dialog";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  targetPreview?: ReactNode;
}

type SnapshotState = { state: "checking" } | TimeoutSnapshotResult;
type Outcome =
  | { state: "idle" }
  | { state: "failure"; message: string }
  | { state: "refreshing" }
  | { state: "refresh-failure" }
  | { state: "success" };

function defaultDuration(snapshot: Extract<TimeoutSnapshotResult, { state: "available" }>): number {
  const tenMinutes = snapshot.policy.durationUnit === "seconds" ? 600 : 10;
  if (tenMinutes >= snapshot.policy.minDuration && tenMinutes <= snapshot.policy.maxDuration) {
    return tenMinutes;
  }
  return snapshot.policy.minDuration;
}

export function StateAwareTimeoutAction({
  binding,
  displayName,
  onPendingChange,
  onSuccess,
  presentation = "trigger",
  open = false,
  onOpenChange,
  targetPreview,
}: StateAwareTimeoutActionProps) {
  const [snapshot, setSnapshot] = useState<SnapshotState>({ state: "checking" });
  const [activeSnapshot, setActiveSnapshot] = useState<
    Extract<TimeoutSnapshotResult, { state: "available" }> | undefined
  >();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState(600);
  const [durationValid, setDurationValid] = useState(true);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const bindingGenerationRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const onPendingChangeRef = useRef(onPendingChange);
  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);
  const {
    action,
    channelId,
    channelSlug,
    platform,
    selectedMessageId,
    targetUserId,
    targetUsername,
  } = binding;
  const snapshotRequest = useMemo(
    () => ({
      action,
      channelId,
      channelSlug,
      platform,
      ...(selectedMessageId ? { selectedMessageId } : {}),
      targetUserId,
      targetUsername,
    }),
    [action, channelId, channelSlug, platform, selectedMessageId, targetUserId, targetUsername]
  );
  const readSnapshot = useCallback(async (): Promise<TimeoutSnapshotResult> => {
    const moderationApi = window.electronAPI?.moderation;
    if (!moderationApi) return { state: "unavailable", reason: "unverifiable" };
    try {
      return await moderationApi.createTimeoutSnapshot(snapshotRequest);
    } catch {
      return { state: "unavailable", reason: "unverifiable" };
    }
  }, [snapshotRequest]);
  const refreshSnapshot = useCallback(async () => {
    const requestId = ++snapshotRequestRef.current;
    setSnapshot({ state: "checking" });
    const result = await readSnapshot();
    if (snapshotRequestRef.current === requestId) {
      setSnapshot(result);
    }
    return result;
  }, [readSnapshot]);

  useEffect(() => {
    bindingGenerationRef.current += 1;
    snapshotRequestRef.current += 1;
    setConfirmOpen(false);
    setActiveSnapshot(undefined);
    setBusy(false);
    setOutcome({ state: "idle" });
    onPendingChangeRef.current(false);
    void refreshSnapshot();
    return () => {
      bindingGenerationRef.current += 1;
      snapshotRequestRef.current += 1;
    };
  }, [refreshSnapshot]);

  useEffect(
    () => () => {
      onPendingChangeRef.current(false);
    },
    []
  );

  const openConfirmation = () => {
    if (snapshot.state !== "available") return;
    setActiveSnapshot(snapshot);
    setDuration(defaultDuration(snapshot));
    setDurationValid(true);
    setReason("");
    setOutcome({ state: "idle" });
    setRefreshNotice(null);
    setConfirmOpen(true);
  };

  useEffect(() => {
    if (presentation !== "dialog") return;
    if (!open) {
      setConfirmOpen(false);
      setActiveSnapshot(undefined);
      return;
    }
    if (snapshot.state === "available" && !activeSnapshot) {
      setActiveSnapshot(snapshot);
      setDuration(defaultDuration(snapshot));
      setDurationValid(true);
      setReason("");
      setOutcome({ state: "idle" });
      setRefreshNotice(null);
      setConfirmOpen(true);
    }
  }, [activeSnapshot, open, presentation, snapshot]);

  const refreshAfterSuccess = async (bindingGeneration: number) => {
    setOutcome({ state: "refreshing" });
    const [, historyRefresh] = await Promise.allSettled([
      refreshSnapshot(),
      Promise.resolve().then(onSuccess),
    ]);
    if (bindingGenerationRef.current !== bindingGeneration) return;
    setOutcome(
      historyRefresh.status === "fulfilled" ? { state: "success" } : { state: "refresh-failure" }
    );
  };

  const handleResult = async (result: TimeoutSubmitResult, bindingGeneration: number) => {
    if (bindingGenerationRef.current !== bindingGeneration) return;
    if (result.state === "failure") {
      setOutcome({ state: "failure", message: result.message });
      return;
    }
    if (result.state === "invalid-input") {
      setOutcome({ state: "failure", message: result.message });
      return;
    }
    if (result.state === "revalidation-required") {
      setConfirmOpen(false);
      setActiveSnapshot(undefined);
      setRefreshNotice("Moderation state changed. Review the refreshed action before confirming.");
      await refreshSnapshot();
      return;
    }

    showModActionSuccessToast(`Timed out ${displayName}`);
    await refreshAfterSuccess(bindingGeneration);
  };

  const submit = async () => {
    if (!activeSnapshot || busy || !durationValid) return;
    setBusy(true);
    setOutcome({ state: "idle" });
    onPendingChangeRef.current(true);
    const bindingGeneration = bindingGenerationRef.current;
    try {
      const result = await window.electronAPI.moderation.submitTimeout({
        snapshotId: activeSnapshot.snapshotId,
        duration,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (bindingGenerationRef.current !== bindingGeneration) return;
      void handleResult(result, bindingGeneration);
    } catch {
      if (bindingGenerationRef.current !== bindingGeneration) return;
      setOutcome({
        state: "failure",
        message: "The timeout could not be completed. Check your connection and try again.",
      });
    } finally {
      if (bindingGenerationRef.current === bindingGeneration) {
        setBusy(false);
        onPendingChangeRef.current(false);
      }
    }
  };

  const policy = activeSnapshot?.policy;
  const completed =
    outcome.state === "refreshing" ||
    outcome.state === "refresh-failure" ||
    outcome.state === "success";
  const closeConfirmation = () => {
    setConfirmOpen(false);
    setActiveSnapshot(undefined);
    setDurationValid(true);
    setReason("");
    setOutcome({ state: "idle" });
    onOpenChange?.(false);
  };
  const renderedTargetPreview = targetPreview ?? (
    <span>
      <span className="font-medium text-white">@{binding.targetUsername}</span>
      <span className="ml-2 text-[var(--color-foreground-muted)]">in {binding.channelSlug}</span>
    </span>
  );

  return (
    <div
      className={presentation === "trigger" ? "mt-3" : undefined}
      data-testid="state-aware-timeout-action"
    >
      {presentation === "trigger" && snapshot.state === "available" ? (
        <button
          type="button"
          onClick={openConfirmation}
          aria-label="Timeout user"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 text-sm font-medium text-amber-100 hover:bg-amber-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
        >
          <Clock3 className="h-4 w-4" aria-hidden />
          Timeout
        </button>
      ) : presentation === "trigger" &&
        snapshot.state === "unavailable" &&
        snapshot.reason === "unverifiable" ? (
        <button
          type="button"
          aria-label="Refresh moderation actions"
          onClick={() => {
            setRefreshNotice(null);
            void refreshSnapshot();
          }}
          className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Couldn&apos;t verify current actions · Retry
        </button>
      ) : null}

      {refreshNotice ? (
        <p className="mt-2 text-xs text-amber-200" role="status">
          {refreshNotice}
        </p>
      ) : null}

      {presentation === "dialog" && open && !activeSnapshot ? (
        <ModActionConfirmDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeConfirmation();
          }}
          actionType="timeout"
          targetPreview={renderedTargetPreview}
          confirmDisabled
          extraSlot={() => (
            <div className="space-y-2 text-sm text-[var(--color-foreground-muted)]" role="status">
              {snapshot.state === "checking" ? (
                <p>Verifying current moderation state…</p>
              ) : (
                <>
                  <p>
                    This timeout is unavailable because the current moderation state could not be
                    verified.
                  </p>
                  <button
                    type="button"
                    onClick={() => void refreshSnapshot()}
                    className="inline-flex h-8 items-center gap-2 rounded-md bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    Retry verification
                  </button>
                </>
              )}
            </div>
          )}
          onConfirm={() => undefined}
        />
      ) : null}

      {activeSnapshot && policy ? (
        <ModActionConfirmDialog
          open={confirmOpen}
          onOpenChange={(nextOpen) => {
            if (busy) return;
            setConfirmOpen(nextOpen);
            if (!nextOpen) {
              closeConfirmation();
            }
          }}
          actionType="timeout"
          targetPreview={renderedTargetPreview}
          busy={busy}
          confirmDisabled={!durationValid || completed}
          extraSlot={({ disabled }) => (
            <div className="space-y-3">
              <TimeoutDurationPicker
                disabled={disabled || completed}
                policy={policy}
                onChange={setDuration}
                onValidationChange={setDurationValid}
              />
              {policy.supportsReason ? (
                <div>
                  <label
                    htmlFor="timeout-reason"
                    className="mb-1 block text-sm font-medium text-white"
                  >
                    Reason (optional)
                  </label>
                  <textarea
                    id="timeout-reason"
                    value={reason}
                    maxLength={policy.maxReasonLength}
                    disabled={disabled || completed}
                    onChange={(event) => setReason(event.target.value)}
                    className="min-h-20 w-full resize-y rounded-md border border-white/15 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-[#9146FF] disabled:opacity-50"
                  />
                  <p className="mt-1 text-right text-xs text-[var(--color-foreground-muted)]">
                    {reason.length}/{policy.maxReasonLength}
                  </p>
                </div>
              ) : null}
              {outcome.state === "failure" ? (
                <div className="rounded-md border border-red-300/20 bg-red-300/5 p-3" role="alert">
                  <p className="flex items-start gap-2 text-sm text-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {outcome.message}
                  </p>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    className="mt-2 inline-flex h-8 items-center rounded-md bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Retry timeout
                  </button>
                </div>
              ) : outcome.state === "refreshing" ? (
                <p className="flex items-center gap-2 text-sm text-emerald-200" role="status">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Timeout applied. Refreshing moderation history…
                </p>
              ) : outcome.state === "success" ? (
                <p className="flex items-center gap-2 text-sm text-emerald-200" role="status">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Timeout applied and history refreshed.
                </p>
              ) : outcome.state === "refresh-failure" ? (
                <div
                  className="rounded-md border border-amber-300/20 bg-amber-300/5 p-3"
                  role="alert"
                >
                  <p className="flex items-start gap-2 text-sm text-amber-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    Timeout applied, but moderation history could not be refreshed. Try refreshing
                    again.
                  </p>
                  <button
                    type="button"
                    onClick={() => void refreshAfterSuccess(bindingGenerationRef.current)}
                    className="mt-2 inline-flex h-8 items-center rounded-md bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Retry refresh
                  </button>
                </div>
              ) : null}
            </div>
          )}
          onConfirm={() => submit()}
        />
      ) : null}
    </div>
  );
}
