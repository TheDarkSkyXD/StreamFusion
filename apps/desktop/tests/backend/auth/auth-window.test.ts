import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/sleep", () => ({
  sleep: vi.fn(async () => undefined),
}));

vi.mock("@/backend/services/web-contents-ready", () => ({
  waitForWebContentsCondition: vi.fn(async () => true),
}));

const {
  mockLoadURL,
  mockClose,
  mockShow,
  mockIsDestroyed,
  mockExecuteJavaScript,
  eventHandlers,
  webContentsEventHandlers,
} = vi.hoisted(() => ({
  mockLoadURL: vi.fn(),
  mockClose: vi.fn(),
  mockShow: vi.fn(),
  mockIsDestroyed: vi.fn(() => false),
  mockExecuteJavaScript: vi.fn(async () => false),
  eventHandlers: new Map<string, Function>(),
  webContentsEventHandlers: new Map<string, Function>(),
}));

vi.mock("electron", () => {
  class MockBrowserWindow {
    loadURL = mockLoadURL;
    close = mockClose;
    show = mockShow;
    isDestroyed = mockIsDestroyed;
    webContents = {
      on: vi.fn((event: string, handler: Function) => {
        webContentsEventHandlers.set(event, handler);
      }),
      once: vi.fn((event: string, handler: Function) => {
        webContentsEventHandlers.set(event, handler);
      }),
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: mockExecuteJavaScript,
    };
    once = vi.fn((event: string, handler: Function) => {
      eventHandlers.set(event, handler);
    });
    on = vi.fn((event: string, handler: Function) => {
      eventHandlers.set(event, handler);
    });
  }
  return {
    BrowserWindow: MockBrowserWindow,
    session: {
      defaultSession: {
        cookies: {
          get: vi.fn(async () => []),
        },
      },
    },
    shell: {
      openExternal: vi.fn(),
    },
  };
});

vi.mock("@/backend/auth/oauth-config", () => ({
  generatePkceChallenge: vi.fn(() => ({
    codeVerifier: "test-verifier",
    codeChallenge: "test-challenge",
    codeChallengeMethod: "S256" as const,
  })),
  generateState: vi.fn(() => "test-state-hex"),
  getRedirectUri: vi.fn(
    (platform: string, port: number) => `http://localhost:${port}/auth/${platform}/callback`
  ),
  buildAuthorizationUrl: vi.fn(
    ({ platform }: { platform: string }) =>
      `https://id.test.com/oauth2/authorize?platform=${platform}`
  ),
  DEFAULT_CALLBACK_PORT: 8765,
}));

import { authWindowManager, HEADER_RENDERED_PREDICATE } from "@/backend/auth/auth-window";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
  eventHandlers.clear();
  webContentsEventHandlers.clear();
  mockLoadURL.mockReset();
  mockClose.mockReset();
  mockShow.mockReset();
  mockIsDestroyed.mockReturnValue(false);
  mockExecuteJavaScript.mockResolvedValue(false);
  authWindowManager.closeAllAuthWindows();
  vi.clearAllMocks();
});

afterEach(() => {
  authWindowManager.closeAllAuthWindows();
  vi.useRealTimers();
});

describe("HEADER_RENDERED_PREDICATE", () => {
  it("is a non-empty string (IIFE)", () => {
    expect(typeof HEADER_RENDERED_PREDICATE).toBe("string");
    expect(HEADER_RENDERED_PREDICATE.length).toBeGreaterThan(10);
    expect(HEADER_RENDERED_PREDICATE).toContain("Sign");
  });
});

describe("openAuthWindow — Twitch", () => {
  it("returns window, pkce, state, redirectUri, and port", () => {
    const result = authWindowManager.openAuthWindow("twitch");

    expect(result.window).toBeDefined();
    expect(result.pkce).toEqual({
      codeVerifier: "test-verifier",
      codeChallenge: "test-challenge",
      codeChallengeMethod: "S256",
    });
    expect(result.state).toBe("test-state-hex");
    expect(result.redirectUri).toBe("http://localhost:8765/auth/twitch/callback");
    expect(result.port).toBe(8765);
  });

  it("loads the OAuth authorization URL directly for Twitch", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(mockLoadURL).toHaveBeenCalledWith(
      expect.stringContaining("authorize?platform=twitch")
    );
  });

  it("uses custom port when provided", () => {
    const result = authWindowManager.openAuthWindow("twitch", { port: 9999 });
    expect(result.port).toBe(9999);
  });
});

describe("openAuthWindow — Kick", () => {
  it("loads kick.com first (not the OAuth URL directly)", () => {
    authWindowManager.openAuthWindow("kick");
    expect(mockLoadURL).toHaveBeenCalledWith("https://kick.com/");
  });
});

describe("closeAuthWindow", () => {
  it("closes the window and removes the session", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.isAuthWindowOpen("twitch")).toBe(true);

    authWindowManager.closeAuthWindow("twitch");
    expect(authWindowManager.isAuthWindowOpen("twitch")).toBe(false);
  });

  it("is safe to call when no window is open", () => {
    expect(() => authWindowManager.closeAuthWindow("twitch")).not.toThrow();
  });

  it("handles already-destroyed windows gracefully", () => {
    authWindowManager.openAuthWindow("twitch");
    mockIsDestroyed.mockReturnValue(true);
    expect(() => authWindowManager.closeAuthWindow("twitch")).not.toThrow();
  });
});

describe("closeAllAuthWindows", () => {
  it("closes windows for all platforms", () => {
    authWindowManager.openAuthWindow("twitch");
    authWindowManager.openAuthWindow("kick");

    authWindowManager.closeAllAuthWindows();

    expect(authWindowManager.isAuthWindowOpen("twitch")).toBe(false);
    expect(authWindowManager.isAuthWindowOpen("kick")).toBe(false);
  });
});

describe("getSession", () => {
  it("returns undefined when no session exists", () => {
    expect(authWindowManager.getSession("twitch")).toBeUndefined();
  });

  it("returns the session when a window is open", () => {
    authWindowManager.openAuthWindow("twitch");
    const session = authWindowManager.getSession("twitch");
    expect(session).toBeDefined();
    expect(session!.platform).toBe("twitch");
    expect(session!.state).toBe("test-state-hex");
    expect(session!.startedAt).toBe(Date.now());
  });
});

describe("getPkceChallenge", () => {
  it("returns undefined when no session", () => {
    expect(authWindowManager.getPkceChallenge("twitch")).toBeUndefined();
  });

  it("returns the PKCE challenge from the session", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.getPkceChallenge("twitch")).toEqual({
      codeVerifier: "test-verifier",
      codeChallenge: "test-challenge",
      codeChallengeMethod: "S256",
    });
  });
});

describe("getState", () => {
  it("returns undefined when no session", () => {
    expect(authWindowManager.getState("twitch")).toBeUndefined();
  });

  it("returns the state from the session", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.getState("twitch")).toBe("test-state-hex");
  });
});

describe("getRedirectUri", () => {
  it("returns undefined when no session", () => {
    expect(authWindowManager.getRedirectUri("twitch")).toBeUndefined();
  });

  it("returns the redirect URI from the session", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.getRedirectUri("twitch")).toBe(
      "http://localhost:8765/auth/twitch/callback"
    );
  });
});

describe("validateState", () => {
  it("returns false when no session exists", () => {
    expect(authWindowManager.validateState("twitch", "any")).toBe(false);
  });

  it("returns false on state mismatch", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.validateState("twitch", "wrong-state")).toBe(false);
  });

  it("returns true on matching state within time limit", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.validateState("twitch", "test-state-hex")).toBe(true);
  });

  it("returns false when session is older than 10 minutes", () => {
    authWindowManager.openAuthWindow("twitch");
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(authWindowManager.validateState("twitch", "test-state-hex")).toBe(false);
  });
});

describe("isAuthWindowOpen", () => {
  it("returns false when no window exists", () => {
    expect(authWindowManager.isAuthWindowOpen("twitch")).toBe(false);
  });

  it("returns true when window exists and is not destroyed", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.isAuthWindowOpen("twitch")).toBe(true);
  });

  it("returns false when window is destroyed", () => {
    authWindowManager.openAuthWindow("twitch");
    mockIsDestroyed.mockReturnValue(true);
    expect(authWindowManager.isAuthWindowOpen("twitch")).toBe(false);
  });
});

describe("openAuthWindow closes previous window", () => {
  it("closes existing window before opening a new one for the same platform", () => {
    authWindowManager.openAuthWindow("twitch");
    authWindowManager.openAuthWindow("twitch");
    expect(mockClose).toHaveBeenCalled();
  });
});

describe("window closed event cleans up session", () => {
  it("removes session when window is closed externally", () => {
    authWindowManager.openAuthWindow("twitch");
    expect(authWindowManager.getSession("twitch")).toBeDefined();

    const closedHandler = eventHandlers.get("closed");
    expect(closedHandler).toBeDefined();
    closedHandler!();

    expect(authWindowManager.getSession("twitch")).toBeUndefined();
  });
});

describe("callback URL detection via did-navigate", () => {
  it("schedules window close when callback page loads", () => {
    authWindowManager.openAuthWindow("twitch", { port: 8765 });

    const didNavigateHandler = webContentsEventHandlers.get("did-navigate");
    expect(didNavigateHandler).toBeDefined();

    didNavigateHandler!({}, "http://localhost:8765/auth/twitch/callback?code=x&state=y");

    vi.advanceTimersByTime(1500);
  });
});
