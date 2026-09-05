import { useEffect, useState } from "react";

import type {
  DiagnosticsHistoryContext,
  DiagnosticsHistoryRange,
  DiagnosticsHistorySelection,
  DiagnosticsHistorySeries,
} from "@shared/diagnostics-types";

type HistoryState<T> =
  | { readonly kind: "idle"; readonly value: null }
  | { readonly kind: "loading"; readonly value: T | null }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "error"; readonly value: T | null; readonly diagnosticId: string };

const IDLE_HISTORY_STATE: HistoryState<DiagnosticsHistorySeries> = { kind: "idle", value: null };
const IDLE_CONTEXT_STATE: HistoryState<DiagnosticsHistoryContext> = { kind: "idle", value: null };

export function useDiagnosticsResourceHistory({
  leaseId,
  range,
  endAtMs,
  selection,
}: {
  readonly leaseId: string | null;
  readonly range: DiagnosticsHistoryRange;
  readonly endAtMs: number;
  readonly selection: DiagnosticsHistorySelection | null;
}): {
  readonly history: HistoryState<DiagnosticsHistorySeries>;
  readonly context: HistoryState<DiagnosticsHistoryContext>;
} {
  const [history, setHistory] =
    useState<HistoryState<DiagnosticsHistorySeries>>(IDLE_HISTORY_STATE);
  const [context, setContext] =
    useState<HistoryState<DiagnosticsHistoryContext>>(IDLE_CONTEXT_STATE);

  useEffect(() => {
    if (!leaseId) {
      setHistory(IDLE_HISTORY_STATE);
      return;
    }

    let cancelled = false;
    setHistory((current) => ({ kind: "loading", value: current.value }));
    void window.electronAPI.diagnostics
      .queryResourceHistory({ leaseId, range, endAtMs })
      .then((reply) => {
        if (cancelled) return;
        if (reply.kind === "ok") {
          setHistory({ kind: "ready", value: reply.value });
          return;
        }
        setHistory((current) => ({
          kind: "error",
          value: current.value,
          diagnosticId: reply.error.diagnosticId,
        }));
      })
      .catch(() => {
        if (!cancelled)
          setHistory((current) => ({
            kind: "error",
            value: current.value,
            diagnosticId: "history-bridge-unavailable",
          }));
      });

    return () => {
      cancelled = true;
    };
  }, [endAtMs, leaseId, range]);

  useEffect(() => {
    if (!leaseId || !selection) {
      setContext(IDLE_CONTEXT_STATE);
      return;
    }

    let cancelled = false;
    setContext((current) => ({ kind: "loading", value: current.value }));
    void window.electronAPI.diagnostics
      .queryResourceContext({ leaseId, selection })
      .then((reply) => {
        if (cancelled) return;
        if (reply.kind === "ok") {
          setContext({ kind: "ready", value: reply.value });
          return;
        }
        setContext((current) => ({
          kind: "error",
          value: current.value,
          diagnosticId: reply.error.diagnosticId,
        }));
      })
      .catch(() => {
        if (!cancelled)
          setContext({
            kind: "error",
            value: null,
            diagnosticId: "history-context-bridge-unavailable",
          });
      });

    return () => {
      cancelled = true;
    };
  }, [leaseId, selection]);

  return { history, context };
}
