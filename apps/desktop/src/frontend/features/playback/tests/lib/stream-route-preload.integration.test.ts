import { beforeEach, describe, expect, it, vi } from "vitest";

const chatModuleGate = vi.hoisted(() => {
  type ChatModule = { ChatPanel: () => null };
  let resolveModule: ((module: ChatModule) => void) | undefined;
  return {
    factoryCalls: vi.fn(),
    modulePromise: Promise.resolve<ChatModule>({ ChatPanel: () => null }),
    reset() {
      this.factoryCalls.mockClear();
      this.modulePromise = new Promise<ChatModule>((resolve) => {
        resolveModule = resolve;
      });
    },
    resolve: () => resolveModule?.({ ChatPanel: () => null }),
  };
});

// Guards: both desktop route trees keep intent preloading pending until the nested ChatPanel module is ready.
describe("stream route intent preload integration", () => {
  beforeEach(() => {
    vi.resetModules();
    chatModuleGate.reset();
    vi.doUnmock("@/features/chat/components/chat/ChatPanel");
    vi.doMock("@/features/chat/components/chat/ChatPanel", () => {
      chatModuleGate.factoryCalls();
      return chatModuleGate.modulePromise;
    });
  });

  it.each(["legacy", "start"] as const)(
    "keeps %s intent preloading pending until chat is ready",
    async (renderer) => {
      const router =
        renderer === "legacy"
          ? (await import("@/routes/router")).router
          : (await import("@/routes/start-router")).getRouter();
      await import("@/features/playback/components/screens/Stream");
      let completed = false;
      const destination = {
        to: "/stream/$platform/$channel" as const,
        params: { platform: "twitch", channel: "preload-proof" },
      };
      const preload = router.preloadRoute(destination).then((matches) => {
        completed = true;
        return matches;
      });
      try {
        await vi.waitFor(() => expect(chatModuleGate.factoryCalls).toHaveBeenCalledTimes(1));
        expect(completed).toBe(false);

        chatModuleGate.resolve();
        const matches = await preload;
        expect(completed).toBe(true);
        expect(matches?.at(-1)?.pathname).toBe("/stream/twitch/preload-proof");
        expect(matches?.at(-1)?.status).toBe("success");
      } finally {
        chatModuleGate.resolve();
        router.history.destroy();
      }
    }
  );
});
