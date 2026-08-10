import { afterEach, describe, expect, it, vi } from "vitest";

import { OnDemandSeekRecoveryController } from "@/components/player/on-demand-seek-recovery-controller";

function createManualRecoveryScheduler() {
  const scheduled = new Map<
    number,
    { delayMs: number; callback: () => void; cancelled: boolean }
  >();
  let nextId = 0;

  return {
    schedule(delayMs: number, callback: () => void) {
      const id = nextId++;
      scheduled.set(id, { delayMs, callback, cancelled: false });
      return {
        cancel: () => {
          const pending = scheduled.get(id);
          if (!pending || pending.cancelled) return false;
          pending.cancelled = true;
          return true;
        },
      };
    },
    run(delayMs: number) {
      [...scheduled.values()]
        .filter((pending) => pending.delayMs === delayMs && !pending.cancelled)
        .forEach((pending) => {
          pending.cancelled = true;
          pending.callback();
        });
    },
  };
}

// Guards: a superseded on-demand seek can never recover after a newer target is committed.
// Guards: only the newest generation's first presented frame within one second of its target completes recovery.
// Guards: an unresolved seek follows one bounded soft, hard, then terminal recovery ladder.
// Guards: explicit cancellation silences pending recovery and late frames without blocking a later seek.
// Guards: meaningful remote-keyframe convergence postpones only pending stages without retry storms.
// Guards: convergence can postpone intervention but never extend the absolute terminal recovery budget.
describe("OnDemandSeekRecoveryController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves cancellation, latest-generation, and deadline semantics through the recovery scheduler", () => {
    const onRecovery = vi.fn();
    const scheduler = createManualRecoveryScheduler();
    const controller = new OnDemandSeekRecoveryController({
      onRecovery,
      scheduleRecovery: scheduler.schedule,
    });

    const cancelledGeneration = controller.commitSeek(12);
    controller.cancel();
    scheduler.run(2_500);

    const supersededGeneration = controller.commitSeek(48);
    const latestGeneration = controller.commitSeek(80);
    scheduler.run(2_500);
    scheduler.run(5_500);
    scheduler.run(7_500);

    expect(onRecovery.mock.calls.map(([recovery]) => recovery)).toEqual([
      { generation: latestGeneration, targetSeconds: 80, stage: "soft" },
      { generation: latestGeneration, targetSeconds: 80, stage: "hard" },
      { generation: latestGeneration, targetSeconds: 80, stage: "terminal" },
    ]);
    expect(onRecovery).not.toHaveBeenCalledWith(
      expect.objectContaining({ generation: cancelledGeneration })
    );
    expect(onRecovery).not.toHaveBeenCalledWith(
      expect.objectContaining({ generation: supersededGeneration })
    );
  });

  it("runs soft recovery only for the newest committed seek generation", () => {
    vi.useFakeTimers();
    const onRecovery = vi.fn();
    const controller = new OnDemandSeekRecoveryController({ onRecovery });

    const generationA = controller.commitSeek(12);
    vi.advanceTimersByTime(1_000);
    const generationB = controller.commitSeek(48);

    vi.advanceTimersByTime(2_499);
    expect(onRecovery).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenCalledTimes(1);
    expect(onRecovery).toHaveBeenCalledWith({
      generation: generationB,
      targetSeconds: 48,
      stage: "soft",
    });
    expect(onRecovery).not.toHaveBeenCalledWith(
      expect.objectContaining({ generation: generationA })
    );
  });

  it("completes only on the newest generation's first presented frame within tolerance", () => {
    vi.useFakeTimers();
    const onRecovery = vi.fn();
    const onSuccess = vi.fn();
    const controller = new OnDemandSeekRecoveryController({ onRecovery, onSuccess });

    const generationA = controller.commitSeek(12);
    const generationB = controller.commitSeek(48);
    controller.notePresentedFrame(generationA, 12);
    controller.notePresentedFrame(generationB, 46.9);

    vi.advanceTimersByTime(2_500);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith({
      generation: generationB,
      targetSeconds: 48,
      stage: "soft",
    });

    const generationC = controller.commitSeek(80);
    controller.notePresentedFrame(generationC, 79.25);
    controller.notePresentedFrame(generationC, 80.25);
    vi.advanceTimersByTime(2_500);

    expect(onSuccess).toHaveBeenCalledExactlyOnceWith({
      generation: generationC,
      targetSeconds: 80,
      presentedSeconds: 79.25,
    });
    expect(onRecovery).toHaveBeenCalledTimes(1);
  });

  it("emits the bounded recovery stages at absolute elapsed thresholds", () => {
    vi.useFakeTimers();
    const onRecovery = vi.fn();
    const controller = new OnDemandSeekRecoveryController({ onRecovery });

    const generation = controller.commitSeek(30);

    vi.advanceTimersByTime(2_499);
    expect(onRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenLastCalledWith({
      generation,
      targetSeconds: 30,
      stage: "soft",
    });

    vi.advanceTimersByTime(2_999);
    expect(onRecovery).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenLastCalledWith({
      generation,
      targetSeconds: 30,
      stage: "hard",
    });

    vi.advanceTimersByTime(1_999);
    expect(onRecovery).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenLastCalledWith({
      generation,
      targetSeconds: 30,
      stage: "terminal",
    });

    vi.advanceTimersByTime(100_000);
    expect(onRecovery.mock.calls.map(([recovery]) => recovery.stage)).toEqual([
      "soft",
      "hard",
      "terminal",
    ]);
  });

  it("cancels the active generation and permits a later seek to recover", () => {
    vi.useFakeTimers();
    const onRecovery = vi.fn();
    const onSuccess = vi.fn();
    const controller = new OnDemandSeekRecoveryController({ onRecovery, onSuccess });

    const canceledGeneration = controller.commitSeek(30);
    vi.advanceTimersByTime(1_000);
    controller.cancel();
    controller.notePresentedFrame(canceledGeneration, 30);
    vi.advanceTimersByTime(100_000);

    expect(onRecovery).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    const laterGeneration = controller.commitSeek(60);
    expect(laterGeneration).toBeGreaterThan(canceledGeneration);
    vi.advanceTimersByTime(2_500);

    expect(onRecovery).toHaveBeenCalledExactlyOnceWith({
      generation: laterGeneration,
      targetSeconds: 60,
      stage: "soft",
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("resets pending stage deadlines only for meaningful latest-generation convergence", () => {
    vi.useFakeTimers();
    const onRecovery = vi.fn();
    const onSuccess = vi.fn();
    const controller = new OnDemandSeekRecoveryController({ onRecovery, onSuccess });

    const staleGeneration = controller.commitSeek(10);
    const convergingGeneration = controller.commitSeek(100);
    vi.advanceTimersByTime(1_000);
    controller.notePresentedFrame(convergingGeneration, 90);
    vi.advanceTimersByTime(1_400);
    controller.notePresentedFrame(convergingGeneration, 90.1);
    vi.advanceTimersByTime(2_400);

    expect(onRecovery).not.toHaveBeenCalled();
    controller.notePresentedFrame(convergingGeneration, 99.5);
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith({
      generation: convergingGeneration,
      targetSeconds: 100,
      presentedSeconds: 99.5,
    });

    const latestGeneration = controller.commitSeek(200);
    vi.advanceTimersByTime(1_000);
    controller.notePresentedFrame(latestGeneration, 190);
    vi.advanceTimersByTime(1_000);
    controller.notePresentedFrame(latestGeneration, 190.1);
    vi.advanceTimersByTime(2_400);
    controller.notePresentedFrame(staleGeneration, 10);
    vi.advanceTimersByTime(99);
    expect(onRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenLastCalledWith({
      generation: latestGeneration,
      targetSeconds: 200,
      stage: "soft",
    });

    vi.advanceTimersByTime(100);
    controller.notePresentedFrame(latestGeneration, 190.2);
    vi.advanceTimersByTime(2_499);
    expect(onRecovery).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(onRecovery).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenLastCalledWith({
      generation: latestGeneration,
      targetSeconds: 200,
      stage: "terminal",
    });

    vi.advanceTimersByTime(100_000);
    expect(onRecovery.mock.calls.map(([recovery]) => recovery.stage)).toEqual(["soft", "terminal"]);
  });

  it("never postpones terminal recovery beyond the generation's absolute budget", () => {
    vi.useFakeTimers();
    const onRecovery = vi.fn();
    const controller = new OnDemandSeekRecoveryController({ onRecovery });

    const generation = controller.commitSeek(100);
    controller.notePresentedFrame(generation, 80);

    vi.advanceTimersByTime(2_499);
    controller.notePresentedFrame(generation, 80.1);
    vi.advanceTimersByTime(2_500);
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith({
      generation,
      targetSeconds: 100,
      stage: "soft",
    });

    vi.advanceTimersByTime(500);
    controller.notePresentedFrame(generation, 80.2);
    vi.advanceTimersByTime(2_000);
    expect(onRecovery).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onRecovery).toHaveBeenLastCalledWith({
      generation,
      targetSeconds: 100,
      stage: "terminal",
    });

    vi.advanceTimersByTime(100_000);
    expect(onRecovery.mock.calls.map(([recovery]) => recovery.stage)).toEqual(["soft", "terminal"]);
  });
});
