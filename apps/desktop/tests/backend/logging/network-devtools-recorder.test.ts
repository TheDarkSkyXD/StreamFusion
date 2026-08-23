import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/network-request-logger", () => ({
  isNetworkStreamRequestUrl: vi.fn(() => true),
  networkRequestUrlFingerprint: vi.fn(() => "fingerprint"),
  recordDevtoolsNetworkRequestHint: vi.fn(),
}));

vi.mock("@/backend/logging/source-map-resolver", () => ({
  resolveSourceMappedLocation: vi.fn(),
}));

import { installNetworkDevtoolsRecorder } from "@/backend/logging/network-devtools-recorder";
import { recordDevtoolsNetworkRequestHint } from "@/backend/logging/network-request-logger";
import { resolveSourceMappedLocation } from "@/backend/logging/source-map-resolver";

const recordHintMock = vi.mocked(recordDevtoolsNetworkRequestHint);
const resolveSourceMappedLocationMock = vi.mocked(resolveSourceMappedLocation);

function makeWebContents() {
  let messageHandler:
    | ((event: unknown, method: string, params?: Record<string, unknown>) => void)
    | undefined;

  const fake = {
    debugger: {
      attach: vi.fn(),
      isAttached: vi.fn(() => false),
      on: vi.fn((_event: string, handler: typeof messageHandler) => {
        messageHandler = handler;
      }),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    },
    emitDebuggerMessage(method: string, params: Record<string, unknown>) {
      messageHandler?.({}, method, params);
    },
  };

  return fake;
}

// Guards: closing WebContents while Network.enable is pending must not surface an unhandled rejection
describe("installNetworkDevtoolsRecorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records DevTools-style initiator stack hints for stream requests", () => {
    resolveSourceMappedLocationMock.mockReturnValueOnce({
      column: 8,
      display: "xhr-loader.ts:166",
      line: 166,
      source: "file:///repo/node_modules/hls.js/dist/src/utils/xhr-loader.ts",
      url: "file:///repo/node_modules/hls.js/dist/src/utils/xhr-loader.ts",
    });

    const fake = makeWebContents();

    installNetworkDevtoolsRecorder(fake as unknown as Electron.WebContents);

    fake.emitDebuggerMessage("Network.requestWillBeSent", {
      initiator: {
        stack: {
          callFrames: [
            {
              columnNumber: 9,
              functionName: "openAndSendXhr",
              lineNumber: 27826,
              url: "http://localhost:5173/node_modules/.vite/deps/hls__js.js?v=808c741b",
            },
          ],
        },
        type: "script",
      },
      request: {
        headers: { Referer: "http://localhost:5173/" },
        url: "https://fa723fc1b171.use21.playlist.live-video.net/v1/playlist/token.m3u8",
      },
      timestamp: 123,
    });

    expect(fake.debugger.attach).toHaveBeenCalledWith("1.3");
    expect(fake.debugger.sendCommand).toHaveBeenCalledWith("Network.enable");
    expect(recordHintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedInitiator: "hls__js.js:27827",
        generatedInitiatorColumn: 9,
        generatedInitiatorLine: 27827,
        generatedInitiatorUrl:
          "http://localhost:5173/node_modules/.vite/deps/hls__js.js?v=808c741b",
        initiator: "xhr-loader.ts:166",
        initiatorColumn: 8,
        initiatorFunction: "openAndSendXhr",
        initiatorLine: 166,
        initiatorType: "script",
        initiatorUrl: "file:///repo/node_modules/hls.js/dist/src/utils/xhr-loader.ts",
        requestHeaders: { Referer: "http://localhost:5173/" },
        sourceMappedInitiator: true,
        timestamp: 123,
        urlFingerprint: "fingerprint",
      })
    );
  });

  it("observes the Network.enable rejection when the debugger target closes", () => {
    const targetClosed = new Error("target closed while handling command");
    const handleRejection = vi.fn((onRejected: (reason: Error) => void) => {
      onRejected(targetClosed);
      return Promise.resolve();
    });
    const fake = makeWebContents();
    fake.debugger.sendCommand.mockReturnValueOnce({
      catch: handleRejection,
    } as unknown as Promise<void>);

    installNetworkDevtoolsRecorder(fake as unknown as Electron.WebContents);

    expect(handleRejection).toHaveBeenCalledOnce();
  });
});
