// IPC handler wrapper — maps thrown errors to the existing `{success, error: string}` envelope.

import { ipcMain } from "electron";

interface ErrorEnvelope {
  success: false;
  error: string;
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export type HandlerResult<T> = SuccessEnvelope<T> | ErrorEnvelope;

export function wrapHandler<TPayload, TData>(
  channel: string,
  fn: (payload: TPayload) => Promise<TData>
): void {
  ipcMain.handle(channel, async (_event, payload: TPayload): Promise<HandlerResult<TData>> => {
    try {
      const data = await fn(payload);
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
}
