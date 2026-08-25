import type { BrowserWindow } from "electron";

import {
  diagnosticsIpcContracts,
  diagnosticsSnapshotChangedSchema,
} from "../../../ipc-contracts/diagnostics-contracts";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { diagnosticsObservability } from "../../diagnostics/diagnostics-observability";
import { diagnosticsRuntime } from "../../diagnostics/diagnostics-runtime-singleton";
import type { TrustedIpcRegistry } from "../trusted-ipc-registry";

export function registerDiagnosticsHandlers(
  mainWindow: BrowserWindow,
  registry: TrustedIpcRegistry
): void {
  const ownerId = mainWindow.webContents.id;
  const internalError = () => registry.internalError();

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_OPEN_LEASE,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_OPEN_LEASE],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: async (_event, request) =>
      diagnosticsObservability.runSpan("diagnostics.openLease", async () => {
        const value = await diagnosticsRuntime.openLease({
          ownerId,
          documentInstanceId: request.documentInstanceId,
          view: request.view,
          publish: (leaseId, snapshot) => {
            if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
            const payload = diagnosticsSnapshotChangedSchema.safeParse({
              leaseId,
              snapshot,
            });
            if (payload.success) {
              mainWindow.webContents.send(IPC_CHANNELS.DIAGNOSTICS_SNAPSHOT_CHANGED, payload.data);
            }
          },
        });
        return { kind: "ok", value } as const;
      }),
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_CONFIGURE_LEASE,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_CONFIGURE_LEASE],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (_event, request) => {
      const snapshot = diagnosticsRuntime.configureLease(ownerId, request.leaseId, request.view);
      return snapshot ? ({ kind: "ok", value: snapshot } as const) : internalError();
    },
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_CLOSE_LEASE,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_CLOSE_LEASE],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (_event, request) => {
      diagnosticsRuntime.closeLease(ownerId, request.leaseId);
      return { kind: "ok", value: null } as const;
    },
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_REFRESH,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_REFRESH],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: async (_event, request) =>
      diagnosticsObservability.runSpan("diagnostics.refresh", async () => {
        const snapshot = await diagnosticsRuntime.refresh(ownerId, request.leaseId);
        return snapshot ? ({ kind: "ok", value: snapshot } as const) : internalError();
      }),
  });

  registry.handle({
    channel: IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER,
    contract: diagnosticsIpcContracts[IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER],
    failureResponse: internalError(),
    createFailureResponse: internalError,
    execute: (_event, request) => {
      diagnosticsRuntime.reportRendererPerformance(ownerId, request);
      return { kind: "ok", value: null } as const;
    },
  });

  mainWindow.webContents.once("destroyed", () => diagnosticsRuntime.closeOwner(ownerId));
}
