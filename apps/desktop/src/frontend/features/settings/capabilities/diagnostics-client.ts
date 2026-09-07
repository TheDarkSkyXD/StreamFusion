import type {
  DiagnosticsActivityReport,
  DiagnosticsHistoryContext,
  DiagnosticsHistoryRange,
  DiagnosticsHistorySelection,
  DiagnosticsHistorySeries,
  DiagnosticsLeaseOpened,
  DiagnosticsSnapshot,
  DiagnosticsSnapshotChanged,
  DiagnosticsView,
  RendererPerformanceSummary,
} from "@shared/diagnostics-types";
import type { Result as IpcReply } from "@streamfusion/core/reliability";

export interface DiagnosticsClient {
  openLease(request: {
    documentInstanceId: string;
    view: DiagnosticsView;
  }): Promise<IpcReply<DiagnosticsLeaseOpened>>;
  configureLease(request: {
    leaseId: string;
    view: DiagnosticsView;
  }): Promise<IpcReply<DiagnosticsSnapshot>>;
  closeLease(leaseId: string): Promise<IpcReply<null>>;
  refresh(leaseId: string): Promise<IpcReply<DiagnosticsSnapshot>>;
  reportRenderer(summary: RendererPerformanceSummary): Promise<IpcReply<null>>;
  reportActivity(report: DiagnosticsActivityReport): Promise<IpcReply<null>>;
  queryResourceHistory(request: {
    leaseId: string;
    range: DiagnosticsHistoryRange;
    endAtMs: number;
  }): Promise<IpcReply<DiagnosticsHistorySeries>>;
  queryResourceContext(request: {
    leaseId: string;
    selection: DiagnosticsHistorySelection;
  }): Promise<IpcReply<DiagnosticsHistoryContext>>;
  onSnapshotChanged(callback: (event: DiagnosticsSnapshotChanged) => void): () => void;
}
