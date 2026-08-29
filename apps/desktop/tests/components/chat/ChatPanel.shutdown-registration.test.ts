import { describe, expect, it, vi } from "vitest";

const registerAppShutdownTask = vi.hoisted(() => vi.fn());
const shutdownLoadedChatServices = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/features/shell/utils/app-shutdown-registry", () => ({ registerAppShutdownTask }));
vi.mock("@backend/services/emotes", () => ({ ensureEmoteProvidersInitialized: vi.fn() }));
vi.mock("@/features/chat/components/chat/kick/KickChat", () => ({ KickChat: vi.fn() }));
vi.mock("@/features/chat/components/chat/twitch/TwitchChat", () => ({ TwitchChat: vi.fn() }));
vi.mock("@/components/dev/use-render-count", () => ({ useRenderCount: vi.fn() }));
vi.mock("@backend/services/chat/chat-service-loader", () => ({
  preloadChatService: vi.fn().mockResolvedValue(undefined),
  shutdownLoadedChatServices,
}));

// Guards: the app root cannot register or import chat-service cleanup before the chat feature loads.
// Guards: loading ChatPanel registers shutdown for both chat transports without starting cleanup early.
describe("ChatPanel shutdown registration", () => {
  it("registers chat cleanup when the chat module loads", async () => {
    await import("@/features/chat/components/chat/ChatPanel");

    expect(registerAppShutdownTask).toHaveBeenCalledOnce();
    expect(registerAppShutdownTask).toHaveBeenCalledWith("chat-services", expect.any(Function));
    expect(shutdownLoadedChatServices).not.toHaveBeenCalled();

    const cleanup = registerAppShutdownTask.mock.calls[0]?.[1];
    await cleanup();

    expect(shutdownLoadedChatServices).toHaveBeenCalledOnce();
  });
});
