import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerSystemHandlers: vi.fn(),
  registerAppHandlers: vi.fn(),
  registerStorageHandlers: vi.fn(),
  registerAuthHandlers: vi.fn(),
  registerStreamHandlers: vi.fn(),
  registerCategoryHandlers: vi.fn(),
  registerSearchHandlers: vi.fn(),
  registerChannelHandlers: vi.fn(),
  registerChatHandlers: vi.fn(),
  registerKickChatHandlers: vi.fn(),
  registerModLogHandlers: vi.fn(),
  registerVideoHandlers: vi.fn(),
  registerAdBlockHandlers: vi.fn(),
  registerUpdateHandlers: vi.fn(),
  registerProxyHandlers: vi.fn(),
  applyPersistedProxyOnStart: vi.fn(),
  registerPlatformHealthHandlers: vi.fn(),
  registerTokenStatusHandlers: vi.fn(),
  registerLogHandlers: vi.fn(),
  registerBugReportHandlers: vi.fn(),
  scheduleProactiveRefresh: vi.fn(),
  getBugReportsDir: vi.fn(() => "/fake/bug-reports"),
}));

vi.mock("@/backend/ipc/handlers/system-handlers", () => ({
  registerSystemHandlers: mocks.registerSystemHandlers,
}));
vi.mock("@/backend/ipc/handlers/app-handlers", () => ({
  registerAppHandlers: mocks.registerAppHandlers,
}));
vi.mock("@/backend/ipc/handlers/storage-handlers", () => ({
  registerStorageHandlers: mocks.registerStorageHandlers,
}));
vi.mock("@/backend/ipc/handlers/auth-handlers", () => ({
  registerAuthHandlers: mocks.registerAuthHandlers,
}));
vi.mock("@/backend/ipc/handlers/stream-handlers", () => ({
  registerStreamHandlers: mocks.registerStreamHandlers,
}));
vi.mock("@/backend/ipc/handlers/category-handlers", () => ({
  registerCategoryHandlers: mocks.registerCategoryHandlers,
}));
vi.mock("@/backend/ipc/handlers/search-handlers", () => ({
  registerSearchHandlers: mocks.registerSearchHandlers,
}));
vi.mock("@/backend/ipc/handlers/channel-handlers", () => ({
  registerChannelHandlers: mocks.registerChannelHandlers,
}));
vi.mock("@/backend/ipc/handlers/chat-handlers", () => ({
  registerChatHandlers: mocks.registerChatHandlers,
}));
vi.mock("@/backend/ipc/handlers/kick-chat-handlers", () => ({
  registerKickChatHandlers: mocks.registerKickChatHandlers,
}));
vi.mock("@/backend/ipc/handlers/modlog-handlers", () => ({
  registerModLogHandlers: mocks.registerModLogHandlers,
}));
vi.mock("@/backend/ipc/handlers/video-handlers", () => ({
  registerVideoHandlers: mocks.registerVideoHandlers,
}));
vi.mock("@/backend/ipc/handlers/adblock-handlers", () => ({
  registerAdBlockHandlers: mocks.registerAdBlockHandlers,
}));
vi.mock("@/backend/ipc/handlers/update-handlers", () => ({
  registerUpdateHandlers: mocks.registerUpdateHandlers,
}));
vi.mock("@/backend/ipc/handlers/proxy-handlers", () => ({
  registerProxyHandlers: mocks.registerProxyHandlers,
  applyPersistedProxyOnStart: mocks.applyPersistedProxyOnStart,
}));
vi.mock("@/backend/ipc/handlers/platform-health-handlers", () => ({
  registerPlatformHealthHandlers: mocks.registerPlatformHealthHandlers,
}));
vi.mock("@/backend/ipc/handlers/token-status-handlers", () => ({
  registerTokenStatusHandlers: mocks.registerTokenStatusHandlers,
}));
vi.mock("@/backend/ipc/handlers/log-handlers", () => ({
  registerLogHandlers: mocks.registerLogHandlers,
}));
vi.mock("@/backend/ipc/handlers/bug-report-handlers", () => ({
  registerBugReportHandlers: mocks.registerBugReportHandlers,
}));
vi.mock("@/backend/logging/log-paths", () => ({
  getBugReportsDir: mocks.getBugReportsDir,
}));
vi.mock("@/backend/auth", () => ({
  twitchAuthService: { scheduleProactiveRefresh: mocks.scheduleProactiveRefresh },
}));

import { registerIpcHandlers } from "@/backend/ipc-handlers";

describe("registerIpcHandlers", () => {
  const fakeBrowserWindow = {} as import("electron").BrowserWindow;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls every handler registration function exactly once", () => {
    registerIpcHandlers(fakeBrowserWindow);

    expect(mocks.registerSystemHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerAppHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerStorageHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerAuthHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerStreamHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerCategoryHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerSearchHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerChannelHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerChatHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerKickChatHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerModLogHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerVideoHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerAdBlockHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerUpdateHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerProxyHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerPlatformHealthHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerTokenStatusHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerLogHandlers).toHaveBeenCalledOnce();
    expect(mocks.registerBugReportHandlers).toHaveBeenCalledOnce();
  });

  it("passes the BrowserWindow to handlers that need it", () => {
    registerIpcHandlers(fakeBrowserWindow);

    expect(mocks.registerSystemHandlers).toHaveBeenCalledWith(fakeBrowserWindow);
    expect(mocks.registerAuthHandlers).toHaveBeenCalledWith(fakeBrowserWindow);
    expect(mocks.registerAdBlockHandlers).toHaveBeenCalledWith(fakeBrowserWindow);
    expect(mocks.registerUpdateHandlers).toHaveBeenCalledWith(fakeBrowserWindow);
    expect(mocks.registerPlatformHealthHandlers).toHaveBeenCalledWith(fakeBrowserWindow);
  });

  it("passes the bug reports directory to registerBugReportHandlers", () => {
    registerIpcHandlers(fakeBrowserWindow);
    expect(mocks.registerBugReportHandlers).toHaveBeenCalledWith("/fake/bug-reports");
  });

  it("calls applyPersistedProxyOnStart after registering handlers", () => {
    registerIpcHandlers(fakeBrowserWindow);
    expect(mocks.applyPersistedProxyOnStart).toHaveBeenCalledOnce();
  });

  it("starts the Twitch proactive-refresh timer", () => {
    registerIpcHandlers(fakeBrowserWindow);
    expect(mocks.scheduleProactiveRefresh).toHaveBeenCalledOnce();
  });

  it("does not pass the BrowserWindow to handlers that don't need it", () => {
    registerIpcHandlers(fakeBrowserWindow);

    expect(mocks.registerAppHandlers).toHaveBeenCalledWith();
    expect(mocks.registerStorageHandlers).toHaveBeenCalledWith();
    expect(mocks.registerStreamHandlers).toHaveBeenCalledWith();
    expect(mocks.registerCategoryHandlers).toHaveBeenCalledWith();
    expect(mocks.registerSearchHandlers).toHaveBeenCalledWith();
    expect(mocks.registerChannelHandlers).toHaveBeenCalledWith();
    expect(mocks.registerChatHandlers).toHaveBeenCalledWith();
    expect(mocks.registerKickChatHandlers).toHaveBeenCalledWith();
    expect(mocks.registerModLogHandlers).toHaveBeenCalledWith();
    expect(mocks.registerVideoHandlers).toHaveBeenCalledWith();
    expect(mocks.registerProxyHandlers).toHaveBeenCalledWith();
    expect(mocks.registerTokenStatusHandlers).toHaveBeenCalledWith();
    expect(mocks.registerLogHandlers).toHaveBeenCalledWith();
  });
});
