import { describe, expect, it, vi } from "vitest";
import { createChatMessageGate, startChatSession } from "@/components/chat/chat-startup";

// Guards: independent emote and badge decoration work must not delay joining live chat
describe("chat startup", () => {
  it("joins live chat without waiting for decoration work", async () => {
    let finishDecorations: (() => void) | undefined;
    const decorations = new Promise<void>((resolve) => {
      finishDecorations = resolve;
    });
    const joinLive = vi.fn(async () => undefined);

    await startChatSession({
      joinLive,
      loadHistory: async () => undefined,
      loadDecorations: async () => decorations,
    });

    expect(joinLive).toHaveBeenCalledOnce();
    finishDecorations?.();
  });

  it("observes preparation failures while the live join is still pending", async () => {
    let finishJoin: (() => void) | undefined;
    let historyObserved = false;
    const history = {
      then: (resolve: () => void, reject: (error: Error) => void) => {
        historyObserved = true;
        reject(new Error("history failed"));
        return Promise.resolve().then(resolve);
      },
    } as Promise<void>;

    const startup = startChatSession({
      joinLive: () =>
        new Promise<void>((resolve) => {
          finishJoin = resolve;
        }),
      loadHistory: () => history,
      loadDecorations: async () => undefined,
    });
    await Promise.resolve();

    expect(historyObserved).toBe(true);
    finishJoin?.();
    const session = await startup;
    await expect(session.preparation).rejects.toThrow("history failed");
  });
});

// Guards: live messages received during preparation must retain arrival order when released
describe("chat message preparation gate", () => {
  it("publishes queued live messages in arrival order once preparation finishes", () => {
    const published: string[] = [];
    const gate = createChatMessageGate<string>((message) => published.push(message));

    gate.accept("first-live");
    gate.accept("second-live");
    expect(published).toEqual([]);

    gate.open();
    expect(published).toEqual(["first-live", "second-live"]);
  });

  it("discards queued messages and ignores arrivals after cancellation", () => {
    const published: string[] = [];
    const gate = createChatMessageGate<string>((message) => published.push(message));
    gate.accept("queued-before-cleanup");

    gate.cancel();
    gate.accept("arrived-after-cleanup");
    gate.open();

    expect(published).toEqual([]);
  });
});
