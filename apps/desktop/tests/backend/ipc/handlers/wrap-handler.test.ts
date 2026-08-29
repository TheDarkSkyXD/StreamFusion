import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from "electron";

import { wrapHandler } from "@backend/ipc/handlers/wrap-handler";

type Handler = (event: unknown, payload: unknown) => Promise<unknown>;

function getRegisteredHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wrapHandler", () => {
  it("registers an ipcMain.handle for the given channel", () => {
    wrapHandler("test:channel", async () => "ok");
    expect(ipcMain.handle).toHaveBeenCalledWith("test:channel", expect.any(Function));
  });

  it("wraps a successful result in { success: true, data }", async () => {
    wrapHandler("test:success", async (payload: { x: number }) => payload.x * 2);

    const handler = getRegisteredHandler("test:success");
    const result = await handler({}, { x: 21 });

    expect(result).toEqual({ success: true, data: 42 });
  });

  it("wraps an Error throw in { success: false, error: message }", async () => {
    wrapHandler("test:error", async () => {
      throw new Error("boom");
    });

    const handler = getRegisteredHandler("test:error");
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: false, error: "boom" });
  });

  it("wraps a non-Error throw in { success: false, error: String(thrown) }", async () => {
    wrapHandler("test:string-throw", async () => {
      throw "raw string error";
    });

    const handler = getRegisteredHandler("test:string-throw");
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: false, error: "raw string error" });
  });

  it("passes undefined data through on void-returning fn", async () => {
    wrapHandler("test:void", async () => undefined);

    const handler = getRegisteredHandler("test:void");
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: true, data: undefined });
  });

  it("passes null data through", async () => {
    wrapHandler("test:null", async () => null);

    const handler = getRegisteredHandler("test:null");
    const result = await handler({}, undefined);

    expect(result).toEqual({ success: true, data: null });
  });
});
