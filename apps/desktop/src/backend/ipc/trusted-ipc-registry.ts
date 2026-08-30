import { randomUUID } from "node:crypto";

import type { IpcMainInvokeEvent } from "electron";
import type { IpcChannel } from "../../shared/ipc-channels";
import type { StructuralSchema } from "../../shared/feature-loader-contract";
import type { IpcReply } from "../../shared/reliability-types";
import { registerTrustedIpcHandler } from "./register-trusted-ipc-handler";
import { configureTrustedIpcMain } from "./trusted-ipc-main";
import { getMainRendererDocumentUrl } from "./trusted-document-url";
import type { MainRendererPort } from "./main-renderer-port";

interface TrustedRoute<Request, Response> {
  channel: IpcChannel;
  contract: {
    request: StructuralSchema<Request>;
    response: StructuralSchema<Response>;
  };
  failureResponse: Response;
  createFailureResponse?: () => Response;
  execute: (event: IpcMainInvokeEvent, request: Request) => Promise<Response> | Response;
}

/** The only context allowed to register renderer-to-main invoke routes. */
export class TrustedIpcRegistry {
  readonly #renderer: Pick<MainRendererPort, "trustedSender">;
  readonly #trustedDocumentUrl: string;

  constructor(
    renderer: Pick<MainRendererPort, "trustedSender">,
    trustedDocumentUrl = getMainRendererDocumentUrl()
  ) {
    this.#renderer = renderer;
    this.#trustedDocumentUrl = trustedDocumentUrl;
    configureTrustedIpcMain(() => this.#renderer.trustedSender(), trustedDocumentUrl);
  }

  handle<Request, Response>(route: TrustedRoute<Request, Response>): void {
    registerTrustedIpcHandler({
      channel: route.channel,
      contract: route.contract,
      getTrustedSender: () => this.#renderer.trustedSender(),
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
