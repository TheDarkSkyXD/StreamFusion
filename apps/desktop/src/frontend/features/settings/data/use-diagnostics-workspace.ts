import { useCallback, useEffect, useRef, useState } from "react";

import { startRendererDiagnosticsReporter } from "./diagnostics/renderer-diagnostics-reporter";
import type { DiagnosticsSnapshot, DiagnosticsView } from "../../../../shared/diagnostics-types";

type DiagnosticsWorkspaceState =
  | { readonly kind: "loading"; readonly snapshot: null }
  | { readonly kind: "ready"; readonly snapshot: DiagnosticsSnapshot }
  | {
      readonly kind: "error";
      readonly snapshot: DiagnosticsSnapshot | null;
      readonly diagnosticId: string;
    };

export function useDiagnosticsWorkspace(view: DiagnosticsView) {
  const [state, setState] = useState<DiagnosticsWorkspaceState>({
    kind: "loading",
    snapshot: null,
  });
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const leaseIdRef = useRef<string | null>(null);
  const initialViewRef = useRef(view);

  useEffect(() => startRendererDiagnosticsReporter(), []);

  useEffect(() => {
    let cancelled = false;
    const documentInstanceId = crypto.randomUUID();
    const removeSnapshotListener = window.electronAPI.diagnostics.onSnapshotChanged((event) => {
      if (event.leaseId !== leaseIdRef.current) return;
      setState({ kind: "ready", snapshot: event.snapshot });
    });

    void window.electronAPI.diagnostics
      .openLease({ documentInstanceId, view: initialViewRef.current })
      .then(async (reply) => {
        if (reply.kind === "error") {
          if (!cancelled) {
            setState({ kind: "error", snapshot: null, diagnosticId: reply.error.diagnosticId });
          }
          return;
        }
        if (cancelled) {
          await window.electronAPI.diagnostics.closeLease(reply.value.leaseId);
          return;
        }
        leaseIdRef.current = reply.value.leaseId;
        setLeaseId(reply.value.leaseId);
        setState({ kind: "ready", snapshot: reply.value.snapshot });
      });

    return () => {
      cancelled = true;
      removeSnapshotListener();
      const leaseId = leaseIdRef.current;
      leaseIdRef.current = null;
      setLeaseId(null);
      if (leaseId) void window.electronAPI.diagnostics.closeLease(leaseId);
    };
  }, []);

  useEffect(() => {
    const leaseId = leaseIdRef.current;
    if (!leaseId) return;
    let cancelled = false;
    void window.electronAPI.diagnostics.configureLease({ leaseId, view }).then((reply) => {
      if (cancelled) return;
      if (reply.kind === "ok") {
        setState({ kind: "ready", snapshot: reply.value });
      } else {
        setState((current) => ({
          kind: "error",
          snapshot: current.snapshot,
          diagnosticId: reply.error.diagnosticId,
        }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  const refresh = useCallback(async () => {
    const leaseId = leaseIdRef.current;
    if (!leaseId) return;
    const reply = await window.electronAPI.diagnostics.refresh(leaseId);
    if (reply.kind === "ok") {
      setState({ kind: "ready", snapshot: reply.value });
    } else {
      setState((current) => ({
        kind: "error",
        snapshot: current.snapshot,
        diagnosticId: reply.error.diagnosticId,
      }));
    }
  }, []);

  return { ...state, leaseId, refresh };
}
