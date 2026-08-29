import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const setAsDefaultProtocolClient = vi.fn();
const removeAsDefaultProtocolClient = vi.fn();
const onHandlers = new Map<string, Function>();
const requestSingleInstanceLock = vi.fn(() => true);
const quit = vi.fn();
const exit = vi.fn();
const getAllWindows = vi.fn(() => [] as unknown[]);

vi.mock("electron", () => ({
  app: {
    setAsDefaultProtocolClient: (...a: unknown[]) => setAsDefaultProtocolClient(...a),
    removeAsDefaultProtocolClient: (...a: unknown[]) => removeAsDefaultProtocolClient(...a),
    requestSingleInstanceLock: () => requestSingleInstanceLock(),
    on: vi.fn((event: string, handler: Function) => {
      onHandlers.set(event, handler);
    }),
    quit: () => quit(),
    exit: (code?: number) => exit(code),
  },
  BrowserWindow: {
    getAllWindows: () => getAllWindows(),
  },
}));

vi.mock("@backend/auth/oauth-config", () => ({
  PROTOCOL_SCHEME: "streamfusion",
  PROTOCOL_PREFIX: "streamfusion://",
}));

import { protocolHandler } from "@backend/auth/protocol-handler";

beforeEach(() => {
  protocolHandler.offCallback("twitch");
  protocolHandler.offCallback("kick");
  if (protocolHandler.registered) {
    protocolHandler.unregisterProtocol();
  }
  vi.clearAllMocks();
  onHandlers.clear();
  getAllWindows.mockReturnValue([]);
});

// Keep the legacy triple-slash form covered alongside the documented two-slash URL.
const BASE = "streamfusion:///auth";

describe("handleProtocolUrl", () => {
  it("parses the documented two-slash Twitch callback URL", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl(
      "streamfusion://auth/twitch/callback?code=DOCUMENTED_CODE&state=DOCUMENTED_STATE"
    );

    expect(handler).toHaveBeenCalledWith({
      platform: "twitch",
      code: "DOCUMENTED_CODE",
      state: "DOCUMENTED_STATE",
      error: undefined,
      errorDescription: undefined,
    });
  });

  it("parses a valid Twitch callback and calls the registered handler", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl(`${BASE}/twitch/callback?code=CODE123&state=STATE456`);

    expect(handler).toHaveBeenCalledWith({
      platform: "twitch",
      code: "CODE123",
      state: "STATE456",
      error: undefined,
      errorDescription: undefined,
    });
  });

  it("parses a valid Kick callback", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("kick", handler);

    protocolHandler.handleProtocolUrl(`${BASE}/kick/callback?code=KICK_CODE&state=S`);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        code: "KICK_CODE",
        state: "S",
      })
    );
  });

  it("passes error and errorDescription when present", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl(
      `${BASE}/twitch/callback?error=access_denied&error_description=User+denied`
    );

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "twitch",
        code: "",
        error: "access_denied",
        errorDescription: "User denied",
      })
    );
  });

  it("sets code to empty string when missing", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl(`${BASE}/twitch/callback?state=S`);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ code: "" }));
  });

  it("ignores invalid path (not starting with auth)", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl("streamfusion:///settings/twitch");

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores path with fewer than 2 parts after auth", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl("streamfusion:///auth");

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores unknown platform", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl(`${BASE}/youtube/callback?code=C&state=S`);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when no handler is registered for the platform", () => {
    expect(() =>
      protocolHandler.handleProtocolUrl(`${BASE}/twitch/callback?code=C&state=S`)
    ).not.toThrow();
  });

  it("handles malformed URLs without throwing", () => {
    expect(() => protocolHandler.handleProtocolUrl("not-a-valid-url")).not.toThrow();
  });

  it("handles empty string without throwing", () => {
    expect(() => protocolHandler.handleProtocolUrl("")).not.toThrow();
  });
});

describe("onCallback / offCallback", () => {
  it("registers and invokes platform handler", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl(`${BASE}/twitch/callback?code=C`);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("offCallback removes the handler", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);
    protocolHandler.offCallback("twitch");

    protocolHandler.handleProtocolUrl(`${BASE}/twitch/callback?code=C`);

    expect(handler).not.toHaveBeenCalled();
  });

  it("replaces existing handler on second onCallback call", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    protocolHandler.onCallback("twitch", handler1);
    protocolHandler.onCallback("twitch", handler2);

    protocolHandler.handleProtocolUrl(`${BASE}/twitch/callback?code=C`);

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

describe("registerProtocol", () => {
  it("returns true on successful registration", () => {
    const result = protocolHandler.registerProtocol();
    expect(result).toBe(true);
    expect(protocolHandler.registered).toBe(true);
  });

  it("returns true immediately on duplicate registration", () => {
    protocolHandler.registerProtocol();
    const result = protocolHandler.registerProtocol();
    expect(result).toBe(true);
  });

  it("registers protocol handling without acquiring or terminating an app instance", () => {
    protocolHandler.registerProtocol();

    expect(requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("second-instance handoff", () => {
  it("restores a minimized primary window and forwards the deep link", () => {
    const helperWindow = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      focus: vi.fn(),
    };
    const mainWindow = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      focus: vi.fn(),
    };
    const twitchCallback = vi.fn();
    getAllWindows.mockReturnValue([helperWindow, mainWindow]);
    protocolHandler.onCallback("twitch", twitchCallback);
    protocolHandler.registerProtocol({ resolveMainWindow: () => mainWindow });

    const secondInstanceHandler = onHandlers.get("second-instance");
    expect(secondInstanceHandler).toBeTypeOf("function");

    secondInstanceHandler?.({}, [`${BASE}/twitch/callback?code=SECOND_CODE&state=SECOND_STATE`]);

    expect(mainWindow.isMinimized).toHaveBeenCalledOnce();
    expect(mainWindow.restore).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
    expect(helperWindow.isMinimized).not.toHaveBeenCalled();
    expect(helperWindow.restore).not.toHaveBeenCalled();
    expect(helperWindow.focus).not.toHaveBeenCalled();
    expect(twitchCallback).toHaveBeenCalledOnce();
    expect(twitchCallback).toHaveBeenCalledWith({
      platform: "twitch",
      code: "SECOND_CODE",
      state: "SECOND_STATE",
      error: undefined,
      errorDescription: undefined,
    });
  });
});

describe("unregisterProtocol", () => {
  it("calls removeAsDefaultProtocolClient when registered", () => {
    protocolHandler.registerProtocol();
    protocolHandler.unregisterProtocol();

    expect(removeAsDefaultProtocolClient).toHaveBeenCalledWith("streamfusion");
    expect(protocolHandler.registered).toBe(false);
  });

  it("is a no-op when not registered", () => {
    protocolHandler.unregisterProtocol();
    expect(removeAsDefaultProtocolClient).not.toHaveBeenCalled();
  });
});

describe("registered getter", () => {
  it("reflects registration state", () => {
    expect(protocolHandler.registered).toBe(false);
    protocolHandler.registerProtocol();
    expect(protocolHandler.registered).toBe(true);
    protocolHandler.unregisterProtocol();
    expect(protocolHandler.registered).toBe(false);
  });
});

describe("state parameter handling", () => {
  it("sets state to undefined when absent from URL", () => {
    const handler = vi.fn();
    protocolHandler.onCallback("twitch", handler);

    protocolHandler.handleProtocolUrl(`${BASE}/twitch/callback?code=C`);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ state: undefined }));
  });
});
