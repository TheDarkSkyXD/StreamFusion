import { afterEach, describe, expect, it, vi } from "vitest";

const preloadStreamPage = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

vi.mock("@/pages", () => ({ preloadStreamPage }));

// Guards: concurrent stream-link intent must share one Stream + Chat warmup and remain pending until the chat module is ready.
// Guards: best-effort chunk failures must not become unhandled rejections or poison later hover retries.
describe("stream route intent preload", () => {
  afterEach(() => {
    preloadStreamPage.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("waits for first paint then immediately warms Stream and Chat with a completion mark", async () => {
    preloadStreamPage.mockResolvedValue(undefined);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const requestIdle = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdle);
    const { scheduleStreamExperienceStartupPrewarm } = await import("@/lib/stream-route-preload");

    scheduleStreamExperienceStartupPrewarm();
    expect(preloadStreamPage).not.toHaveBeenCalled();

    frames[0](0);
    await vi.waitFor(() => expect(preloadStreamPage).toHaveBeenCalledTimes(1));
    expect(requestIdle).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        (
          window as typeof window & {
            __streamExperiencePrewarm?: { status: string; completedAt?: number };
          }
        ).__streamExperiencePrewarm
      ).toMatchObject({ status: "ready", completedAt: expect.any(Number) })
    );
  });

  it("swallows a startup warmup failure and leaves the next intent retryable", async () => {
    preloadStreamPage
      .mockRejectedValueOnce(new Error("startup chunk unavailable"))
      .mockResolvedValueOnce(undefined);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { preloadStreamExperience, scheduleStreamExperienceStartupPrewarm } = await import(
      "@/lib/stream-route-preload"
    );

    scheduleStreamExperienceStartupPrewarm();
    frames[0](0);
    await vi.waitFor(() => expect(preloadStreamPage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(
        (
          window as typeof window & {
            __streamExperiencePrewarm?: { status: string };
          }
        ).__streamExperiencePrewarm?.status
      ).toBe("failed")
    );

    await expect(preloadStreamExperience()).resolves.toBeUndefined();
    expect(preloadStreamPage).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent intent and resolves only after chat is ready", async () => {
    let resolveChat: (() => void) | undefined;
    preloadStreamPage.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveChat = resolve;
      })
    );
    const { preloadStreamExperience } = await import("@/lib/stream-route-preload");

    const first = preloadStreamExperience();
    const second = preloadStreamExperience();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(preloadStreamPage).toHaveBeenCalledTimes(1));

    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveChat?.();
    await expect(first).resolves.toBeUndefined();
  });

  it("absorbs a failed best-effort warmup and retries on the next intent", async () => {
    preloadStreamPage
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce(undefined);
    const { preloadStreamExperience } = await import("@/lib/stream-route-preload");

    await expect(preloadStreamExperience()).resolves.toBeUndefined();
    await expect(preloadStreamExperience()).resolves.toBeUndefined();

    expect(preloadStreamPage).toHaveBeenCalledTimes(2);
  });
});
