import type { IpcReply, SafeAppError } from "@shared/reliability-types";

export class IpcReplyError extends Error {
  constructor(readonly detail: SafeAppError) {
    super(`IPC request failed (${detail.code}, ${detail.diagnosticId})`);
    this.name = "IpcReplyError";
  }
}

export function unwrapIpcReply<T>(reply: IpcReply<T>): T {
  if (reply.kind === "ok") return reply.value;
  throw new IpcReplyError(reply.error);
}
