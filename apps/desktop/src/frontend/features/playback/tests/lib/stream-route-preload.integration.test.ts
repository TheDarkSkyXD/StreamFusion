import { describe, expect, it, vi } from "vitest";

const chatModuleGate = vi.hoisted(() => {
  type ChatModule = { ChatPanel: () => null };
  let resolveModule: ((module: ChatModule) => void) | undefined;
  const modulePromise = new Promise<ChatModule>((resolve) => {
    resolveModule = resolve;
  });
  return {
    factoryCalls: vi.fn(),
    modulePromise,
    resolve: () => resolveModule?.({ ChatPanel: () => null }),
  };
});

vi.mock("@/features/chat/components/chat/ChatPanel", () => {
  chatModuleGate.factoryCalls();
  return chatModuleGate.modulePromise;
});

import { router as legacyRouter } from "@/routes/router";
import { getRouter } from "@/routes/start-router";
import "@/features/playback/components/screens/Stream";

// Guards: both desktop route trees keep intent preloading pending until the nested ChatPanel module is ready.
describe("stream route intent preload integration", () => {
  it("keeps legacy and generated Start preloads pending at the same nested chat boundary", async () => {
    const candidate = getRouter();
    const completed: string[] = [];
    const destination = {
      to: "/stream/$platform/$channel" as const,
      params: { platform: "twitch", channel: "preload-proof" },
    };
    const preloads = [
      legacyRouter.preloadRoute(destination).then((matches) => {
        completed.push("legacy");
        return matches;
      }),
      candidate.preloadRoute(destination).then((matches) => {
        completed.push("start");
        return matches;
      }),
    ];
    try {
      await vi.waitFor(() => expect(chatModuleGate.factoryCalls).toHaveBeenCalledTimes(1));
      expect(completed).toEqual([]);

      chatModuleGate.resolve();
      const matches = await Promise.all(preloads);
      expect(completed.sort()).toEqual(["legacy", "start"]);
      for (const result of matches) {
        expect(result?.at(-1)?.pathname).toBe("/stream/twitch/preload-proof");
      }
    } finally {
      chatModuleGate.resolve();
      candidate.history.destroy();
      legacyRouter.history.destroy();
    }
  });
});
