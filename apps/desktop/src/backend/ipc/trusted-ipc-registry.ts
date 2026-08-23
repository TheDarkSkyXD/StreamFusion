import { randomUUID } from "node:crypto";

import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { z } from "zod";

import type { IpcChannel } from "../../shared/ipc-channels";
import type { IpcReply } from "../../shared/reliability-types";
import { registerTrustedIpcHandler } from "./register-trusted-ipc-handler";
import { configureTrustedIpcMain } from "./trusted-ipc-main";
import { getMainRendererDocumentUrl } from "./trusted-document-url";

interface TrustedRoute<Request, Response> {
  channel: IpcChannel;
  contract: {
    request: z.ZodType<Request>;
    response: z.ZodType<Response>;
  };
  failureResponse: Response;
  createFailureResponse?: () => Response;
  execute: (event: IpcMainInvokeEvent, request: Request) => Promise<Response> | Response;
}

/** The only context allowed to register renderer-to-main invoke routes. */
export class TrustedIpcRegistry {
  readonly #mainWindow: BrowserWindow;
  readonly #trustedDocumentUrl: string;

  constructor(mainWindow: BrowserWindow, trustedDocumentUrl = getMainRendererDocumentUrl()) {
    this.#mainWindow = mainWindow;
    this.#trustedDocumentUrl = trustedDocumentUrl;
    configureTrustedIpcMain(mainWindow.webContents, trustedDocumentUrl);
  }

  handle<Request, Response>(route: TrustedRoute<Request, Response>): void {
    registerTrustedIpcHandler({
      channel: route.channel,
      contract: route.contract,
      trustedSender: this.#mainWindow.webContents,
      trustedDocumentUrl: this.#trustedDocumentUrl,
      handle: route.execute,
      failureResponse: route.failureResponse,
      createFailureResponse: route.createFailureResponse,
    });
  }

  internalError(): IpcReply<never> {
    return {
      kind: "error",
      error: {
        code: "internal",
        retry: { kind: "manual" },
        diagnosticId: randomUUID(),
      },
    };
  }
}
