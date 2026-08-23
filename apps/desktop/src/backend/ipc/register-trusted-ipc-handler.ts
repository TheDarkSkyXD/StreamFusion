import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { z } from "zod";

import { logger } from "../logging/logger";
import type { IpcChannel } from "../../shared/ipc-channels";
import { isAllowedSender } from "./sender-origin";

export type IpcBoundaryFailure =
  "untrusted-sender" | "invalid-request" | "invalid-response" | "handler-error";

interface IpcContract<Request, Response> {
  request: z.ZodType<Request>;
  response: z.ZodType<Response>;
}

export interface TrustedIpcSender {
  readonly mainFrame: { readonly url: string };
}

interface RegisterTrustedIpcHandlerOptions<Request, Response> {
  channel: IpcChannel;
  contract: IpcContract<Request, Response>;
  trustedSender: TrustedIpcSender;
  trustedDocumentUrl: string;
  handle: (event: IpcMainInvokeEvent, request: Request) => Promise<Response> | Response;
  failureResponse: Response;
}

function reportBoundaryFailure(
  channel: IpcChannel,
  failure: IpcBoundaryFailure,
  cause?: unknown
): void {
  const error = cause instanceof Error ? { name: cause.name } : undefined;
  try {
    logger.warn("IPC:Boundary", "Rejected trusted-renderer IPC call", {
      channel,
      failure,
      ...(error ? { error } : {}),
    });
  } catch {
    // Boundary enforcement must still work during isolated startup/tests before logger initialization.
  }
}

function isExpectedRendererDocument(url: string | undefined, trustedDocumentUrl: string): boolean {
  if (!url || !trustedDocumentUrl) return false;

  let parsed: URL;
  let expected: URL;
  try {
    parsed = new URL(url);
    expected = new URL(trustedDocumentUrl);
  } catch {
    return false;
  }

  return (
    parsed.protocol === expected.protocol &&
    parsed.host === expected.host &&
    parsed.pathname === expected.pathname
  );
}

/** Register a validated invoke handler that only accepts the trusted app renderer. */
export function registerTrustedIpcHandler<Request, Response>({
  channel,
  contract,
  trustedSender,
  trustedDocumentUrl,
  handle,
  failureResponse,
}: RegisterTrustedIpcHandlerOptions<Request, Response>): void {
  const parsedFailureResponse = contract.response.safeParse(failureResponse);
  if (!parsedFailureResponse.success) {
    throw new Error(`Invalid fallback response for IPC channel ${channel}`);
  }

  const reject = (failure: IpcBoundaryFailure, cause?: unknown): Response => {
    reportBoundaryFailure(channel, failure, cause);
    return parsedFailureResponse.data;
  };

  ipcMain.handle(channel, async (event, rawRequest: unknown): Promise<Response> => {
    if (
      event.sender !== trustedSender ||
      event.senderFrame !== event.sender.mainFrame ||
      !isAllowedSender(event) ||
      !isExpectedRendererDocument(event.senderFrame?.url, trustedDocumentUrl)
    ) {
      return reject("untrusted-sender");
    }

    const request = contract.request.safeParse(rawRequest);
    if (!request.success) return reject("invalid-request");

    let rawResponse: Response;
    try {
      rawResponse = await handle(event, request.data);
    } catch (error) {
      return reject("handler-error", error);
    }

    const response = contract.response.safeParse(rawResponse);
    if (!response.success) return reject("invalid-response", response.error);
    return response.data;
  });
}
