import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  browserWindowOptions,
  closeWindow,
  loadURL,
  setPermissionCheckHandler,
  setPermissionRequestHandler,
  setWindowOpenHandler,
  focusWindow,
  getUserAgent,
  showWindow,
  windowHandlers,
  webContentsHandlers,
} = vi.hoisted(() => ({
  browserWindowOptions: [] as Array<Record<string, unknown>>,
  closeWindow: vi.fn(),
  loadURL: vi.fn(async (_url: string, _options?: { userAgent?: string }) => undefined),
  setPermissionCheckHandler: vi.fn(),
  setPermissionRequestHandler: vi.fn(),
  setWindowOpenHandler: vi.fn(),
  focusWindow: vi.fn(),
  getUserAgent: vi.fn(() => "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Electron/40.0.0"),
  showWindow: vi.fn(),
  windowHandlers: new Map<string, (...args: unknown[]) => void>(),
  webContentsHandlers: new Map<string, (...args: unknown[]) => void>(),
}));

vi.mock("electron", () => ({
  BrowserWindow: class MockBrowserWindow {
    isDestroyed = vi.fn(() => false);
    close = closeWindow;
    focus = focusWindow;
    show = showWindow;
    loadURL = loadURL;
    once = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      windowHandlers.set(event, handler);
    });
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      windowHandlers.set(event, handler);
    });
    webContents = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        webContentsHandlers.set(event, handler);
      }),
      setWindowOpenHandler,
      session: { getUserAgent, setPermissionCheckHandler, setPermissionRequestHandler },
    };

    constructor(options: Record<string, unknown>) {
      browserWindowOptions.push(options);
    }
  },
}));

import { twitchDeviceAuthWindow } from "@/backend/auth/twitch-device-auth-window";

beforeEach(() => {
  windowHandlers.get("closed")?.();
  browserWindowOptions.length = 0;
  windowHandlers.clear();
  webContentsHandlers.clear();
  loadURL.mockClear();
  closeWindow.mockClear();
  setWindowOpenHandler.mockClear();
  setPermissionCheckHandler.mockClear();
  setPermissionRequestHandler.mockClear();
  focusWindow.mockClear();
  getUserAgent.mockClear();
  showWindow.mockClear();
});

// Guards: Twitch device authorization opens only in a locked-down, top-level popup.
describe("Twitch device authorization popup", () => {
  it("opens the prefilled Twitch activation URL with sandboxed web preferences", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );

    expect(browserWindowOptions).toHaveLength(1);
    expect(browserWindowOptions[0]).toMatchObject({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: false,
      },
    });
    expect(browserWindowOptions[0]?.webPreferences).not.toHaveProperty("preload");
    expect(browserWindowOptions[0]).not.toHaveProperty("parent");
    expect(loadURL).toHaveBeenCalledWith(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH",
      expect.any(Object)
    );
  });

  it("shows and focuses the authorization popup after loading when ready-to-show was missed", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );

    expect(showWindow).toHaveBeenCalledTimes(1);
    expect(focusWindow).toHaveBeenCalledTimes(1);
  });

  it("loads Twitch activation without identifying the popup as Electron", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );

    expect(loadURL).toHaveBeenCalledWith(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH",
      {
        userAgent: expect.stringContaining("Chrome/"),
      }
    );
    const loadOptions = loadURL.mock.calls[0]?.[1] as { userAgent?: string } | undefined;
    expect(loadOptions?.userAgent).not.toContain("Electron/");
  });

  it("denies permission requests from the Twitch authorization page", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const permissionHandler = setPermissionRequestHandler.mock.calls[0]?.[0];
    const decision = vi.fn();

    permissionHandler({}, "notifications", decision);

    expect(decision).toHaveBeenCalledWith(false);
    expect(setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    expect(setPermissionCheckHandler.mock.calls[0]?.[0]()).toBe(false);
  });

  it("rejects a verification URL outside Twitch before opening a window", async () => {
    await expect(
      twitchDeviceAuthWindow.open("https://attacker.example/activate?device-code=stolen")
    ).rejects.toThrow("Invalid Twitch verification URL");

    expect(browserWindowOptions).toHaveLength(0);
    expect(loadURL).not.toHaveBeenCalled();
  });

  it.each([
    "https://user@www.twitch.tv/activate?public=true&device-code=ABCD-EFGH",
    "https://www.twitch.tv:444/activate?public=true&device-code=ABCD-EFGH",
    "https://www.twitch.tv/activate?public=false&device-code=ABCD-EFGH",
    "https://www.twitch.tv/activate?public=true",
    "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH&next=evil",
  ])("rejects a non-canonical verification URL: %s", async (verificationUrl) => {
    await expect(twitchDeviceAuthWindow.open(verificationUrl)).rejects.toThrow(
      "Invalid Twitch verification URL"
    );

    expect(browserWindowOptions).toHaveLength(0);
  });

  it("blocks navigation outside the expected Twitch HTTPS origins", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const navigate = webContentsHandlers.get("will-navigate");
    expect(navigate).toBeDefined();

    const unsafeEvent = { preventDefault: vi.fn() };
    navigate!(unsafeEvent, "javascript:alert(document.cookie)");
    expect(unsafeEvent.preventDefault).toHaveBeenCalledTimes(1);

    const twitchEvent = { preventDefault: vi.fn() };
    navigate!(twitchEvent, "https://www.twitch.tv/login");
    expect(twitchEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("allows Twitch's activation authorization origin after device activation", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const navigate = webContentsHandlers.get("will-navigate");
    const event = { preventDefault: vi.fn() };

    navigate?.(event, "https://auth.twitch.tv/authorize");

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("allows Twitch's OAuth service after the activation handoff", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const navigate = webContentsHandlers.get("will-navigate");
    const event = { preventDefault: vi.fn() };

    navigate?.(event, "https://id.twitch.tv/oauth2/authorize");

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("allows Twitch's Google sign-in handoff to complete private authentication", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const navigate = webContentsHandlers.get("will-navigate");
    const event = { preventDefault: vi.fn() };

    navigate?.(event, "https://accounts.google.com/signin/oauth");

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("allows Twitch's registered loopback callback to complete device authorization", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const navigate = webContentsHandlers.get("will-navigate");
    const event = { preventDefault: vi.fn() };

    navigate?.(event, "http://localhost:8765/auth/twitch/callback");

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("closes promptly when Twitch reaches the registered completion callback", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const redirect = webContentsHandlers.get("will-redirect");
    closeWindow.mockClear();

    redirect?.({}, "http://localhost:8765/auth/twitch/callback");

    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://attacker.example/login",
    "https://user@www.twitch.tv/login",
    "https://www.twitch.tv:444/login",
    "http://localhost:8765/not-the-auth-callback",
    "http://localhost:8766/auth/twitch/callback",
  ])("blocks an unsafe redirect target: %s", async (targetUrl) => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const redirect = webContentsHandlers.get("will-redirect");
    const event = { preventDefault: vi.fn() };

    redirect?.(event, targetUrl);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("denies every request to open another window", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const openHandler = setWindowOpenHandler.mock.calls[0]?.[0];
    expect(openHandler).toBeTypeOf("function");

    expect(openHandler({ url: "https://www.twitch.tv/help" })).toEqual({ action: "deny" });
    expect(openHandler({ url: "file:///C:/Windows/System32/calc.exe" })).toEqual({
      action: "deny",
    });
  });

  it("blocks webviews from being attached to the authorization popup", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    const attachWebview = webContentsHandlers.get("will-attach-webview");
    const event = { preventDefault: vi.fn() };

    attachWebview?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("reports when the user closes the popup", async () => {
    const popup = await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    let closed = false;
    void popup.closed.then(() => {
      closed = true;
    });

    windowHandlers.get("closed")?.();
    await Promise.resolve();

    expect(closed).toBe(true);
  });

  it("closes the popup when Twitch fails to load", async () => {
    const secretCode = "SECRET-DEVICE-CODE";
    loadURL.mockRejectedValueOnce(
      new Error(
        `ERR_FAILED loading https://www.twitch.tv/activate?public=true&device-code=${secretCode}`,
        { cause: new Error(`Chromium cause ${secretCode}`) }
      )
    );

    const caught = await twitchDeviceAuthWindow
      .open("https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH")
      .catch((error: Error) => error);

    expect(caught).toMatchObject({ message: "Unable to open Twitch authorization window" });
    expect(String(caught)).not.toContain(secretCode);
    expect((caught as Error).cause).toBeUndefined();
    expect(closeWindow).toHaveBeenCalled();
  });

  it("closes the popup when Chromium reports a failed navigation", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH"
    );
    closeWindow.mockClear();

    webContentsHandlers.get("did-fail-load")?.();

    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale closed event clear the newer popup", async () => {
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=FIRST-CODE"
    );
    const reportFirstClosed = windowHandlers.get("closed");
    await twitchDeviceAuthWindow.open(
      "https://www.twitch.tv/activate?public=true&device-code=SECOND-CODE"
    );
    closeWindow.mockClear();

    reportFirstClosed?.();
    twitchDeviceAuthWindow.close();

    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});
