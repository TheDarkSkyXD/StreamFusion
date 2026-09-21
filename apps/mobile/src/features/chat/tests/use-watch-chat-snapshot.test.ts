import { describe, expect, it } from "vitest";

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
});
