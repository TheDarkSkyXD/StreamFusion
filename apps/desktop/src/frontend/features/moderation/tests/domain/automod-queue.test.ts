import { describe, expect, it } from "vitest";
import { reduceAutoModQueue, type AutoModQueueState } from "../../domain/automod-queue";

describe("AutoMod retained queue", () => {
  it("bounds a long unattended feed while keeping deduplication and overflow disclosure", () => {
    let queue: AutoModQueueState = { messages: [], overflowed: false };
    for (let index = 0; index < 1000; index += 1) {
      queue = reduceAutoModQueue(queue, {
        type: "hold",
        message: { id: String(index), user: "Viewer", text: "Held", reason: "AutoMod" },
      });
    }
    expect(queue.messages).toHaveLength(100);
    expect(queue.messages[0].id).toBe("900");
    expect(queue.messages[99].id).toBe("999");
    expect(queue.overflowed).toBe(true);
    const duplicate = reduceAutoModQueue(queue, { type: "hold", message: queue.messages[0] });
    expect(duplicate).toBe(queue);
    queue = reduceAutoModQueue(queue, { type: "invalidate" });
    expect(queue.messages.every((message) => !message.verified)).toBe(true);
    const restored = reduceAutoModQueue(queue, { type: "hold", message: queue.messages[0] });
    expect(restored.messages[0].verified).toBe(true);
    expect(restored.messages.slice(1).every((message) => !message.verified)).toBe(true);
    expect(reduceAutoModQueue(restored, { type: "remove", id: "999" }).messages).toHaveLength(99);
    expect(reduceAutoModQueue(restored, { type: "reset" })).toEqual({
      messages: [],
      overflowed: false,
    });
  });
});
