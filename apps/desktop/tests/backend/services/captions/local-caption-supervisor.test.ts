import { describe, expect, it, vi } from "vitest";

import {
  type CaptionUtilityProcess,
  LocalCaptionSupervisor,
} from "@backend/services/captions/local-caption-supervisor";

class FakeUtilityProcess implements CaptionUtilityProcess {
  readonly postMessage = vi.fn();
  readonly kill = vi.fn();
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: "message" | "exit", listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: "message" | "exit", ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

// Guards: multistream owns one explicit local-caption lease, never one recognizer per mounted player.
describe("LocalCaptionSupervisor", () => {
  it("replaces the previous lease and utility process when another stream explicitly starts", () => {
    const children = [new FakeUtilityProcess(), new FakeUtilityProcess()];
    const spawn = vi.fn(() => children.shift() as FakeUtilityProcess);
    const onState = vi.fn();
    const supervisor = new LocalCaptionSupervisor({ spawn, onState });

    supervisor.start({
      sessionId: "kick:alpha",
      generation: 1,
      modelPath: "C:/models/english",
    });
    supervisor.start({
      sessionId: "twitch:beta",
      generation: 2,
      modelPath: "C:/models/english",
    });

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(children).toHaveLength(0);
    const first = spawn.mock.results[0].value;
    expect(first.postMessage).toHaveBeenCalledWith({ type: "stop", sessionId: "kick:alpha" });
    expect(first.kill).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith({
      type: "state",
      sessionId: "kick:alpha",
      generation: 1,
      phase: "error",
      error: "Local captions were started in another player. Retry to reclaim captions.",
    });
    expect(spawn.mock.results[1].value.postMessage).toHaveBeenCalledWith({
      type: "start",
      sessionId: "twitch:beta",
      generation: 2,
      modelPath: "C:/models/english",
    });
  });

  it("drops late output from a displaced child even when its identity is reused", () => {
    const first = new FakeUtilityProcess();
    const second = new FakeUtilityProcess();
    const children = [first, second];
    const onResult = vi.fn();
    const supervisor = new LocalCaptionSupervisor({
      spawn: () => children.shift() as FakeUtilityProcess,
      onResult,
    });
    const lease = { sessionId: "twitch:same", generation: 3, modelPath: "C:/models/en" };

    supervisor.start(lease);
    supervisor.start(lease);
    first.emit("message", {
      type: "result",
      sessionId: "twitch:same",
      generation: 3,
      sequence: 9,
      mediaTime: 12,
      cueId: "twitch:same:3:1",
      revision: 1,
      text: "stale words",
      isFinal: false,
      words: [],
    });

    expect(onResult).not.toHaveBeenCalled();
  });

  it("bounds in-flight PCM and rejects stale, oversized, or out-of-order chunks", () => {
    const child = new FakeUtilityProcess();
    const supervisor = new LocalCaptionSupervisor({ spawn: () => child, maxInFlightChunks: 2 });
    supervisor.start({ sessionId: "twitch:active", generation: 4, modelPath: "C:/models/en" });

    const chunk = (sequence: number, overrides: Record<string, unknown> = {}) => ({
      sessionId: "twitch:active",
      generation: 4,
      sequence,
      mediaTime: sequence,
      sampleRate: 16_000 as const,
      samples: new Float32Array(3_200).buffer,
      ...overrides,
    });

    expect(supervisor.pushAudio(chunk(1))).toBe(true);
    expect(supervisor.pushAudio(chunk(2))).toBe(true);
    expect(supervisor.pushAudio(chunk(3))).toBe(false);
    expect(supervisor.pushAudio(chunk(4, { sessionId: "kick:stale" }))).toBe(false);
    expect(supervisor.pushAudio(chunk(4, { generation: 3 }))).toBe(false);

    child.emit("message", {
      type: "ack",
      sessionId: "twitch:active",
      generation: 4,
      sequence: 1,
    });
    expect(supervisor.pushAudio(chunk(3))).toBe(true);
    expect(supervisor.pushAudio(chunk(2))).toBe(false);
    expect(supervisor.pushAudio(chunk(4, { samples: new Float32Array(32_001).buffer }))).toBe(
      false
    );
  });

  it("stops only the matching active lease when captions are switched Off", () => {
    const child = new FakeUtilityProcess();
    const supervisor = new LocalCaptionSupervisor({ spawn: () => child });
    supervisor.start({ sessionId: "kick:active", generation: 9, modelPath: "C:/models/en" });

    expect(supervisor.stop({ sessionId: "twitch:stale", generation: 9 })).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    expect(supervisor.stop({ sessionId: "kick:active", generation: 9 })).toBe(true);
    expect(child.postMessage).toHaveBeenLastCalledWith({
      type: "stop",
      sessionId: "kick:active",
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("releases a crashed utility lease and reports a retryable error", () => {
    const child = new FakeUtilityProcess();
    const onState = vi.fn();
    const supervisor = new LocalCaptionSupervisor({ spawn: () => child, onState });
    supervisor.start({ sessionId: "twitch:active", generation: 7, modelPath: "C:/models/en" });

    child.emit("exit", 1);

    expect(onState).toHaveBeenCalledWith({
      type: "state",
      sessionId: "twitch:active",
      generation: 7,
      phase: "error",
      error: "Local caption recognizer stopped unexpectedly. Retry local captions.",
    });
    expect(
      supervisor.pushAudio({
        sessionId: "twitch:active",
        generation: 7,
        sequence: 1,
        mediaTime: 1,
        sampleRate: 16_000,
        samples: new Float32Array(3_200).buffer,
      })
    ).toBe(false);
  });
});
