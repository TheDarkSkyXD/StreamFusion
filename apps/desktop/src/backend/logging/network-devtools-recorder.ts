import type { WebContents } from "electron";

import {
  isNetworkStreamRequestUrl,
  networkRequestUrlFingerprint,
  recordDevtoolsNetworkRequestHint,
} from "@backend/logging/network-request-logger";
import { resolveSourceMappedLocation } from "@backend/logging/source-map-resolver";

type InitiatorCallFrame = {
  columnNumber?: number;
  functionName?: string;
  lineNumber?: number;
  url?: string;
};

type InitiatorStack = {
  callFrames?: InitiatorCallFrame[];
  parent?: InitiatorStack;
};

type RequestInitiator = {
  columnNumber?: number;
  lineNumber?: number;
  stack?: InitiatorStack;
  type?: string;
  url?: string;
};

type RequestWillBeSentParams = {
  initiator?: RequestInitiator;
  request?: {
    headers?: Record<string, string>;
    url?: string;
  };
  timestamp?: number;
};

type DebuggerEvent = {
  preventDefault?: () => void;
};

export type DisposeNetworkDevtoolsRecorder = () => void;

const installed = new WeakMap<WebContents, DisposeNetworkDevtoolsRecorder>();

function basename(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const name = url.pathname.split("/").filter(Boolean).at(-1);
    return name ?? url.hostname;
  } catch {
    const parts = rawUrl.split(/[\\/]/).filter(Boolean);
    return parts.at(-1) ?? rawUrl;
  }
}

function firstStackFrame(stack: InitiatorStack | undefined): InitiatorCallFrame | undefined {
  let current = stack;
  while (current != null) {
    const frame = current.callFrames?.find((candidate) => candidate.url && candidate.url !== "");
    if (frame != null) return frame;
    current = current.parent;
  }
  return undefined;
}

function formatInitiator(initiator: RequestInitiator | undefined): {
  column?: number;
  display: string;
  functionName?: string;
  generatedColumn?: number;
  generatedDisplay?: string;
  generatedLine?: number;
  generatedUrl?: string;
  line?: number;
  sourceMapped?: boolean;
  type: string;
  url?: string;
} {
  const type = initiator?.type ?? "other";
  const frame = firstStackFrame(initiator?.stack);

  if (frame?.url != null) {
    const line = typeof frame.lineNumber === "number" ? frame.lineNumber + 1 : undefined;
    const generatedDisplay = line == null ? basename(frame.url) : `${basename(frame.url)}:${line}`;
    const mapped = resolveSourceMappedLocation({
      column: frame.columnNumber,
      line,
      url: frame.url,
    });
    if (mapped != null) {
      return {
        column: mapped.column,
        display: mapped.display,
        functionName: frame.functionName,
        generatedColumn: frame.columnNumber,
        generatedDisplay,
        generatedLine: line,
        generatedUrl: frame.url,
        line: mapped.line,
        sourceMapped: true,
        type,
        url: mapped.url,
      };
    }

    return {
      column: frame.columnNumber,
      display: generatedDisplay,
      functionName: frame.functionName,
      line,
      type,
      url: frame.url,
    };
  }

  if (initiator?.url != null && initiator.url !== "") {
    const line = typeof initiator.lineNumber === "number" ? initiator.lineNumber + 1 : undefined;
    const generatedDisplay =
      line == null ? basename(initiator.url) : `${basename(initiator.url)}:${line}`;
    const mapped = resolveSourceMappedLocation({
      column: initiator.columnNumber,
      line,
      url: initiator.url,
    });
    if (mapped != null) {
      return {
        column: mapped.column,
        display: mapped.display,
        generatedColumn: initiator.columnNumber,
        generatedDisplay,
        generatedLine: line,
        generatedUrl: initiator.url,
        line: mapped.line,
        sourceMapped: true,
        type,
        url: mapped.url,
      };
    }

    return {
      column: initiator.columnNumber,
      display: generatedDisplay,
      line,
      type,
      url: initiator.url,
    };
  }

  return { display: type, type };
}

export function installNetworkDevtoolsRecorder(
  webContents: WebContents
): DisposeNetworkDevtoolsRecorder {
  const existing = installed.get(webContents);
  if (existing) return existing;

  const dbg = webContents.debugger;
  let disposed = false;
  let attachedByRecorder = false;

  const onMessage = (
    _event: DebuggerEvent,
    method: string,
    params?: RequestWillBeSentParams
  ): void => {
    if (method !== "Network.requestWillBeSent") return;
    const url = params?.request?.url;
    if (typeof url !== "string" || !isNetworkStreamRequestUrl(url)) return;

    const initiator = formatInitiator(params?.initiator);
    recordDevtoolsNetworkRequestHint({
      initiator: initiator.display,
      initiatorColumn: initiator.column,
      initiatorFunction: initiator.functionName,
      initiatorLine: initiator.line,
      initiatorType: initiator.type,
      initiatorUrl: initiator.url,
      generatedInitiator: initiator.generatedDisplay,
      generatedInitiatorColumn: initiator.generatedColumn,
      generatedInitiatorLine: initiator.generatedLine,
      generatedInitiatorUrl: initiator.generatedUrl,
      requestHeaders: params?.request?.headers,
      sourceMappedInitiator: initiator.sourceMapped,
      timestamp: params?.timestamp ?? Date.now(),
      urlFingerprint: networkRequestUrlFingerprint(url),
    });
  };

  const cleanup = (detach: boolean): void => {
    if (disposed) return;
    disposed = true;
    installed.delete(webContents);
    webContents.removeListener("destroyed", dispose);
    dbg.removeListener("message", onMessage);
    dbg.removeListener("detach", onDetach);
    if (!detach || !attachedByRecorder) return;
    try {
      dbg.detach();
    } catch {
      return;
    }
  };

  const dispose = (): void => cleanup(true);
  const onDetach = (): void => cleanup(false);

  try {
    if (dbg.isAttached()) return () => undefined;
    dbg.attach("1.3");
    attachedByRecorder = true;
    dbg.on("message", onMessage);
    dbg.on("detach", onDetach);
    webContents.once("destroyed", dispose);
    installed.set(webContents, dispose);
    void dbg.sendCommand("Network.enable").catch(dispose);
  } catch {
    dispose();
  }
  return dispose;
}
