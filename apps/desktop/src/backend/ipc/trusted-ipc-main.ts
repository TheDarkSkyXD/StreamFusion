import { randomUUID } from "node:crypto";

import {
  ipcMain as electronIpcMain,
  type IpcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import { logger } from "@backend/logging/logger";
import { isAllowedSender } from "./sender-origin";
import { registerFeatureRollback } from "./feature-registration-transaction";

const MAX_ARGUMENT_DEPTH = 20;
// Browse snapshots legitimately contain thousands of streams/categories.
// These caps stop pathological clones without rejecting the app's bounded
// persistence payloads during a normal large-catalog refresh.
const MAX_ARGUMENT_NODES = 250_000;
const MAX_STRING_LENGTH = 8 * 1024 * 1024;
const MAX_BINARY_BYTES = 16 * 1024 * 1024;

interface TrustedRendererBinding {
  getSender: () => WebContents | null;
  documentUrl: string;
}

let binding: TrustedRendererBinding | null = null;

function isExpectedDocument(url: string | undefined, expectedUrl: string): boolean {
  if (!url || !expectedUrl) return false;
  try {
    const actual = new URL(url);
    const expected = new URL(expectedUrl);
    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}

function hasSafePayloadBudget(values: unknown[]): boolean {
  const pending = values.map((value) => ({ value, depth: 0 }));
  const visited = new Set<object>();
  let nodes = 0;
  let stringLength = 0;
  let binaryBytes = 0;

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) break;
    nodes += 1;
    if (nodes > MAX_ARGUMENT_NODES || item.depth > MAX_ARGUMENT_DEPTH) return false;
    if (typeof item.value === "string") {
      stringLength += item.value.length;
      if (stringLength > MAX_STRING_LENGTH) return false;
    }
    if (typeof item.value !== "object" || item.value === null) continue;
    if (item.value instanceof ArrayBuffer || ArrayBuffer.isView(item.value)) {
      binaryBytes += item.value.byteLength;
      if (binaryBytes > MAX_BINARY_BYTES) return false;
      continue;
    }
    if (visited.has(item.value)) continue;
    visited.add(item.value);
    if (item.value instanceof Map) {
      for (const [key, value] of item.value) {
        pending.push({ value: key, depth: item.depth + 1 });
        pending.push({ value, depth: item.depth + 1 });
      }
      continue;
    }
    if (item.value instanceof Set) {
      for (const value of item.value) {
        pending.push({ value, depth: item.depth + 1 });
      }
      continue;
    }
    if (typeof Blob !== "undefined" && item.value instanceof Blob) {
      binaryBytes += item.value.size;
      if (binaryBytes > MAX_BINARY_BYTES) return false;
      continue;
    }
    for (const value of Object.values(item.value)) {
      pending.push({ value, depth: item.depth + 1 });
    }
  }
  return true;
}

export function configureTrustedIpcMain(
  getSender: () => WebContents | null,
  documentUrl: string
): void {
  binding = { getSender, documentUrl };
}

function isTrustedEvent(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  if (process.env.NODE_ENV === "test" && binding === null) return true;
  const trustedSender = binding?.getSender() ?? null;
  return (
    binding !== null &&
    trustedSender !== null &&
    event.sender === trustedSender &&
    event.senderFrame === event.sender.mainFrame &&
    isAllowedSender(event) &&
    isExpectedDocument(event.senderFrame?.url, binding.documentUrl)
  );
}

function reportRejected(channel: string, reason: "sender" | "payload-budget"): string {
  const diagnosticId = randomUUID();
  logger.warn("IPC:Boundary", "Rejected trusted IPC call", {
    channel,
    reason,
    diagnosticId,
  });
  return diagnosticId;
}

function sanitizeHandlerError(channel: string, error: unknown): never {
  const diagnosticId = randomUUID();
  logger.error("IPC:Boundary", "Trusted IPC handler failed", {
    channel,
    diagnosticId,
    error: error instanceof Error ? { name: error.name } : undefined,
  });
  throw new Error(`IPC request failed (${diagnosticId})`);
}

/** Restricts IPC calls to the active renderer and bounded structured-clone payloads. */
export const trustedIpcMain: Pick<IpcMain, "handle" | "on" | "removeHandler"> = {
  handle(channel, listener): void {
    electronIpcMain.handle(channel, (event, ...args: unknown[]) => {
      // Isolated handler tests predate the production composition root. They
      // exercise route behavior; the gate itself has dedicated boundary tests.
      const trusted = isTrustedEvent(event);
      if (!trusted || !hasSafePayloadBudget(args)) {
        const diagnosticId = reportRejected(channel, trusted ? "payload-budget" : "sender");
        throw new Error(`IPC request rejected (${diagnosticId})`);
      }

      try {
        const result = listener(event, ...args);
        if (
          typeof result === "object" &&
          result !== null &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          return Promise.resolve(result).catch((error: unknown) =>
            sanitizeHandlerError(channel, error)
          );
        }
        return result;
      } catch (error) {
        return sanitizeHandlerError(channel, error);
      }
    });
    registerFeatureRollback(() => electronIpcMain.removeHandler(channel));
  },
  on(channel, listener): IpcMain {
    const guardedListener = (event: IpcMainEvent, ...args: unknown[]): void => {
      const trusted = isTrustedEvent(event);
      if (!trusted || !hasSafePayloadBudget(args)) {
        reportRejected(channel, trusted ? "payload-budget" : "sender");
        return;
      }
      try {
        listener(event, ...args);
      } catch (error) {
        logger.error("IPC:Boundary", "Trusted IPC event handler failed", {
          channel,
          diagnosticId: randomUUID(),
          error: error instanceof Error ? { name: error.name } : undefined,
        });
      }
    };
    electronIpcMain.on(channel, guardedListener);
    registerFeatureRollback(() => {
      electronIpcMain.removeListener(channel, guardedListener);
    });
    return trustedIpcMain as IpcMain;
  },
  removeHandler(channel): void {
    electronIpcMain.removeHandler(channel);
  },
};
