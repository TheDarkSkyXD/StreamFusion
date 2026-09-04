import { Result as IpcReply, SafeAppError } from "@streamfusion/core/reliability";

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
