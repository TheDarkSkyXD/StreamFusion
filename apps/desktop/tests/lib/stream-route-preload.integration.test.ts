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

vi.mock("@/components/chat", () => {
  chatModuleGate.factoryCalls();
  return chatModuleGate.modulePromise;
});

import { preloadStreamPage } from "@/pages";
import "@/pages/Stream";

// Guards: real intent -> route -> Stream loader composition must not report ready before the nested ChatPanel module is ready.
describe("stream route intent preload integration", () => {
  it("waits through the real Stream page loader's nested ChatPanel boundary", async () => {
    const preload = preloadStreamPage();
    let settled = false;
    void preload.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    chatModuleGate.resolve();
    await expect(preload).resolves.toBeUndefined();
    expect(chatModuleGate.factoryCalls).toHaveBeenCalledTimes(1);
  });
});
