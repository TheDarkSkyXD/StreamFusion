import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { IPC_CHANNELS } from "@shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }));
const loggerMocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle, removeHandler: electronMocks.removeHandler },
}));
vi.mock("@backend/logging/logger", () => ({ logger: { warn: loggerMocks.warn } }));

import { registerTrustedIpcHandler } from "@backend/ipc/register-trusted-ipc-handler";
import { runFeatureRegistrationTransaction } from "@backend/ipc/feature-registration-transaction";

type Handler = (event: unknown, request: unknown) => Promise<unknown>;

function registeredHandler(): Handler {
  const handler = electronMocks.handle.mock.calls[0]?.[1];
  if (!handler) throw new Error("handler not registered");
  return handler as Handler;
}

const trustedDocumentUrl = "http://localhost:5173/";
const allowedFrame = { url: "http://localhost:5173/" };
const trustedSender = { mainFrame: allowedFrame };
const allowedEvent = { sender: trustedSender, senderFrame: allowedFrame };
const failure = { success: false, error: "Unavailable" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  allowedFrame.url = "http://localhost:5173/";
});

// Guards: the reusable main-process boundary validates trust, requests, responses, and errors.
describe("registerTrustedIpcHandler", () => {
  it("passes a validated request to the handler and returns a validated response", async () => {
    const handle = vi.fn(({ value }: { value: string }) => ({ success: true, value }) as const);
    registerTrustedIpcHandler({
      channel: IPC_CHANNELS.STORE_GET,
      contract: {
        request: z.object({ value: z.string().min(1) }).strict(),
        response: z.discriminatedUnion("success", [
          z.object({ success: z.literal(true), value: z.string() }).strict(),
          z.object({ success: z.literal(false), error: z.string() }).strict(),
        ]),
      },
      trustedSender,
      trustedDocumentUrl,
      handle: (_event, request) => handle(request),
      failureResponse: failure,
    });

    await expect(registeredHandler()(allowedEvent, { value: "ok" })).resolves.toEqual({
      success: true,
      value: "ok",
    });
    expect(handle).toHaveBeenCalledWith({ value: "ok" });
  });

  it.each([
    [
      "untrusted-sender",
      {
        sender: { mainFrame: { url: "https://attacker.example" } },
        senderFrame: { url: "https://attacker.example" },
      },
      { value: "ok" },
    ],
    ["invalid-request", allowedEvent, { value: "" }],
  ] as const)("returns a safe failure for %s", async (expectedFailure, event, request) => {
    const handle = vi.fn(() => ({ success: true, value: "ok" }) as const);
    registerTrustedIpcHandler({
      channel: IPC_CHANNELS.STORE_GET,
      contract: {
        request: z.object({ value: z.string().min(1) }).strict(),
        response: z.union([
          z.object({ success: z.literal(true), value: z.string() }).strict(),
          z.object({ success: z.literal(false), error: z.string() }).strict(),
        ]),
      },
      trustedSender,
      trustedDocumentUrl,
      handle,
      failureResponse: failure,
    });

    await expect(registeredHandler()(event, request)).resolves.toEqual(failure);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      "IPC:Boundary",
      "Rejected trusted-renderer IPC call",
      expect.objectContaining({ channel: IPC_CHANNELS.STORE_GET, failure: expectedFailure })
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid-response", () => ({ success: true })],
    ["handler-error", () => Promise.reject(new Error("secret"))],
  ] as const)("returns a safe failure for %s", async (expectedFailure, handle) => {
    registerTrustedIpcHandler({
      channel: IPC_CHANNELS.STORE_GET,
      contract: {
        request: z.object({ value: z.string() }).strict(),
        response: z.union([
          z.object({ success: z.literal(true), value: z.string() }).strict(),
          z.object({ success: z.literal(false), error: z.string() }).strict(),
        ]),
      },
      trustedSender,
      trustedDocumentUrl,
      handle,
      failureResponse: failure,
    });

    await expect(registeredHandler()(allowedEvent, { value: "ok" })).resolves.toEqual(failure);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      "IPC:Boundary",
      "Rejected trusted-renderer IPC call",
      expect.objectContaining({ channel: IPC_CHANNELS.STORE_GET, failure: expectedFailure })
    );
    expect(JSON.stringify(loggerMocks.warn.mock.calls)).not.toContain("secret");
  });

  it.each([
    ["http://localhost:9222/", trustedDocumentUrl],
    ["file:///tmp/renderer/index.html", "file:///C:/StreamFusion/out/renderer/index.html"],
  ])("rejects an unrelated renderer document at %s", async (url, expectedDocumentUrl) => {
    allowedFrame.url = url;
    const handle = vi.fn(() => ({ success: true, value: "ok" }) as const);
    registerTrustedIpcHandler({
      channel: IPC_CHANNELS.STORE_GET,
      contract: {
        request: z.object({ value: z.string() }).strict(),
        response: z.union([
          z.object({ success: z.literal(true), value: z.string() }).strict(),
          z.object({ success: z.literal(false), error: z.string() }).strict(),
        ]),
      },
      trustedSender,
      trustedDocumentUrl: expectedDocumentUrl,
      handle,
      failureResponse: failure,
    });

    await expect(registeredHandler()(allowedEvent, { value: "ok" })).resolves.toEqual(failure);
    expect(handle).not.toHaveBeenCalled();
  });

  it("rejects an invalid fallback response during registration", () => {
    expect(() =>
      registerTrustedIpcHandler({
        channel: IPC_CHANNELS.STORE_GET,
        contract: {
          request: z.object({ value: z.string() }).strict(),
          response: z.object({ success: z.literal(false), error: z.string() }).strict(),
        },
        trustedSender,
        trustedDocumentUrl,
        handle: () => failure,
        failureResponse: { success: false, error: 42 } as unknown as {
          success: false;
          error: string;
        },
      })
    ).toThrow(`Invalid fallback response for IPC channel ${IPC_CHANNELS.STORE_GET}`);
  });

  it("resolves the trusted sender when each request arrives", async () => {
    const firstFrame = { url: trustedDocumentUrl };
    const secondFrame = { url: trustedDocumentUrl };
    const firstSender = { mainFrame: firstFrame };
    const secondSender = { mainFrame: secondFrame };
    let currentSender = firstSender;
    const handle = vi.fn(() => ({ success: true, value: "ok" }) as const);

    registerTrustedIpcHandler({
      channel: IPC_CHANNELS.STORE_GET,
      contract: {
        request: z.object({ value: z.string() }).strict(),
        response: z.union([
          z.object({ success: z.literal(true), value: z.string() }).strict(),
          z.object({ success: z.literal(false), error: z.string() }).strict(),
        ]),
      },
      getTrustedSender: () => currentSender,
      trustedDocumentUrl,
      handle,
      failureResponse: failure,
    });

    const invoke = registeredHandler();
    await expect(
      invoke({ sender: firstSender, senderFrame: firstFrame }, { value: "first" })
    ).resolves.toEqual({ success: true, value: "ok" });

    currentSender = secondSender;
    await expect(
      invoke({ sender: firstSender, senderFrame: firstFrame }, { value: "stale" })
    ).resolves.toEqual(failure);
    await expect(
      invoke({ sender: secondSender, senderFrame: secondFrame }, { value: "second" })
    ).resolves.toEqual({ success: true, value: "ok" });
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("removes a registered handler when its feature transaction fails", async () => {
    await expect(
      runFeatureRegistrationTransaction(async () => {
        registerTrustedIpcHandler({
          channel: IPC_CHANNELS.STORE_GET,
          contract: {
            request: z.object({ value: z.string() }).strict(),
            response: z.object({ success: z.literal(false), error: z.string() }).strict(),
          },
          trustedSender,
          trustedDocumentUrl,
          handle: () => failure,
          failureResponse: failure,
        });
        throw new Error("registration failed");
      })
    ).rejects.toThrow("registration failed");

    expect(electronMocks.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.STORE_GET);
  });
});
