import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registrars = vi.hoisted(() => ({
  registerStreamRecordingHandlers: vi.fn(),
  registerVideoHandlers: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/backend/logging/log-paths", () => ({ getBugReportsDir: () => "bug-reports" }));
vi.mock("@/backend/logging/logger", () => ({ logger: loggerMock }));
vi.mock("@/backend/api/unified/slot-controller", () => ({ setUseWebContentsViews: vi.fn() }));
vi.mock("@/backend/auth", () => ({
  twitchAuthService: { scheduleProactiveRefresh: vi.fn() },
}));
vi.mock("@/backend/ipc/handlers/adblock-handlers", () => ({
  registerAdBlockHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/app-handlers", () => ({ registerAppHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/auth-handlers", () => ({ registerAuthHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/bug-report-handlers", () => ({
  registerBugReportHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/category-handlers", () => ({
  registerCategoryHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/channel-handlers", () => ({
  registerChannelHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/chat-eligibility-handlers", () => ({
  registerChatEligibilityHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/chat-handlers", () => ({ registerChatHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/connectivity-handlers", () => ({
  registerConnectivityHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/download-handlers", () => ({
  registerDownloadHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/emote-handlers", () => ({ registerEmoteHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/kick-chat-handlers", () => ({
  registerKickChatHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/local-caption-handlers", () => ({
  registerLocalCaptionHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/log-handlers", () => ({ registerLogHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/modlog-handlers", () => ({ registerModLogHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/platform-health-handlers", () => ({
  registerPlatformHealthHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/proxy-handlers", () => ({
  applyPersistedProxyOnStart: vi.fn(),
  registerProxyHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/search-handlers", () => ({ registerSearchHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/slot-controller-handlers", () => ({
  registerSlotControllerHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/storage-handlers", () => ({ registerStorageHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/stream-recording-handlers", () => ({
  registerStreamRecordingHandlers: registrars.registerStreamRecordingHandlers,
}));
vi.mock("@/backend/ipc/handlers/stream-handlers", () => ({ registerStreamHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/system-handlers", () => ({ registerSystemHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/timeout-moderation-handlers", () => ({
  registerTimeoutModerationHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/token-status-handlers", () => ({
  registerTokenStatusHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/twitch-api-handlers", () => ({
  registerTwitchApiHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/update-handlers", () => ({ registerUpdateHandlers: vi.fn() }));
vi.mock("@/backend/ipc/handlers/user-profile-handlers", () => ({
  registerUserProfileHandlers: vi.fn(),
}));
vi.mock("@/backend/ipc/handlers/video-handlers", () => ({
  registerVideoHandlers: registrars.registerVideoHandlers,
}));
vi.mock("@/backend/services/captions/local-caption-runtime", () => ({
  getLocalCaptionRuntime: vi.fn(() => ({})),
}));

import { registerIpcHandlers } from "@/backend/ipc-handlers";

// Guards: one broken IPC domain must not leave later domains unregistered and the renderer half-functional.
describe("registerIpcHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs a registrar failure and continues registering later handler groups", () => {
    registrars.registerStreamRecordingHandlers.mockImplementation(() => {
      throw new Error("storage contract missing");
    });

    expect(() => registerIpcHandlers({} as BrowserWindow)).not.toThrow();
    expect(registrars.registerVideoHandlers).toHaveBeenCalledOnce();
    expect(loggerMock.error).toHaveBeenCalledWith(
      "IPC:Bootstrap",
      "Failed to register IPC handler group",
      expect.objectContaining({
        group: "stream-recording",
        error: expect.objectContaining({
          name: "Error",
          message: "storage contract missing",
        }),
      })
    );
  });
});
