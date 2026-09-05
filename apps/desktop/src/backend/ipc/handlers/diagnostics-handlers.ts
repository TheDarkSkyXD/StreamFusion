import {
  diagnosticsIpcContracts,
  diagnosticsSnapshotChangedSchema,
} from "../../../shared/ipc-contracts/diagnostics-contracts";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { diagnosticsObservability } from "../../diagnostics/diagnostics-observability";
import { diagnosticsRuntime } from "../../diagnostics/diagnostics-runtime-singleton";
import type { TrustedIpcRegistry } from "../trusted-ipc-registry";
import type { MainRendererPort } from "../main-renderer-port";
import { registerLoadedFeatureCleanup } from "../../startup/loaded-feature-cleanup";

export function registerDiagnosticsHandlers(
  renderer: MainRendererPort,
  registry: TrustedIpcRegistry
): void {
  const internalError = () => registry.internalError();

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_OPEN_LEASE,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_OPEN_LEASE],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: async (event, request) =>
      diagnosticsObservability.runSpan("diagnostics.openLease", async () => {
        const ownerId = event.sender.id;
        const value = await diagnosticsRuntime.openLease({
          ownerId,
          documentInstanceId: request.documentInstanceId,
          view: request.view,
          publish: (leaseId, snapshot) => {
            const payload = diagnosticsSnapshotChangedSchema.safeParse({
              leaseId,
              snapshot,
            });
            if (payload.success) {
              renderer.sendToOwner(
                ownerId,
                IPC_CHANNELS.DIAGNOSTICS_SNAPSHOT_CHANGED,
                payload.data
              );
            }
          },
        });
        return { kind: "ok", value } as const;
      }),
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_REPORT_ACTIVITY,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_REPORT_ACTIVITY],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (event, request) => {
      diagnosticsRuntime.reportRendererActivity(event.sender.id, request);
      return { kind: "ok", value: null } as const;
    },
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_QUERY_RESOURCE_HISTORY,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_QUERY_RESOURCE_HISTORY],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (event, request) => {
      const value = diagnosticsRuntime.queryResourceHistory(event.sender.id, request.leaseId, { range: request.range, endAtMs: request.endAtMs });
      return value ? ({ kind: "ok", value } as const) : internalError();
    },
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_QUERY_RESOURCE_CONTEXT,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_QUERY_RESOURCE_CONTEXT],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (event, request) => {
      const value = diagnosticsRuntime.queryResourceContext(event.sender.id, request.leaseId, request.selection);
      return value ? ({ kind: "ok", value } as const) : internalError();
    },
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_CONFIGURE_LEASE,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_CONFIGURE_LEASE],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (event, request) => {
      const ownerId = event.sender.id;
      const snapshot = diagnosticsRuntime.configureLease(ownerId, request.leaseId, request.view);
      return snapshot ? ({ kind: "ok", value: snapshot } as const) : internalError();
    },
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_CLOSE_LEASE,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_CLOSE_LEASE],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (event, request) => {
      const ownerId = event.sender.id;
      diagnosticsRuntime.closeLease(ownerId, request.leaseId);
      return { kind: "ok", value: null } as const;
    },
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_REFRESH,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_REFRESH],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: async (event, request) =>
      diagnosticsObservability.runSpan("diagnostics.refresh", async () => {
        const ownerId = event.sender.id;
        const snapshot = await diagnosticsRuntime.refresh(ownerId, request.leaseId);
        return snapshot ? ({ kind: "ok", value: snapshot } as const) : internalError();
      }),
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (event, request) => {
      const ownerId = event.sender.id;
      diagnosticsRuntime.reportRendererPerformance(ownerId, request);
      return { kind: "ok", value: null } as const;
    },
  });

  const stopOwnerBinding = renderer.useWindow("diagnostics:owner", (window) => {
    const ownerId = window.webContents.id;
    return () => diagnosticsRuntime.closeOwner(ownerId);
  });
  registerLoadedFeatureCleanup("diagnostics:owner", stopOwnerBinding);
}
