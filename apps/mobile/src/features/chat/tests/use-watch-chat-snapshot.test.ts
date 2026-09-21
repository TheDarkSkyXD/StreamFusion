import { describe, expect, it, vi } from "vitest";

import { createWatchChatSession } from "../adapters/create-watch-chat-session";
import { CONNECTING_WATCH_CHAT_SNAPSHOT } from "../components/use-watch-chat";

// Guards: null-session getSnapshot must be referentially stable (Multistream empty mount).
describe("useWatchChat getSnapshot stability", () => {
  it("exports a cached connecting snapshot for useSyncExternalStore fallbacks", () => {
    const first = CONNECTING_WATCH_CHAT_SNAPSHOT;
    const second = CONNECTING_WATCH_CHAT_SNAPSHOT;
    expect(first).toBe(second);
    expect(first).toEqual({
      detail: "Connecting guest chat.",
      kind: "connecting",
    });
  });

  it("keeps session.snapshot referentially stable while connecting", () => {
    const session = createWatchChatSession({ fetch: vi.fn() as unknown as typeof fetch });
    expect(session.snapshot()).toBe(session.snapshot());
    expect(session.snapshot().kind).toBe("connecting");
  });
});
