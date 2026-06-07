import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventEmitter } from "@/shared/browser-event-emitter";

describe("BrowserEventEmitter", () => {
  let emitter: InstanceType<typeof EventEmitter>;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe("on / emit", () => {
    it("calls a registered listener when the event fires", () => {
      const listener = vi.fn();
      emitter.on("test", listener);
      emitter.emit("test", "arg1", 42);
      expect(listener).toHaveBeenCalledWith("arg1", 42);
    });

    it("supports multiple listeners on the same event", () => {
      const a = vi.fn();
      const b = vi.fn();
      emitter.on("evt", a);
      emitter.on("evt", b);
      emitter.emit("evt", "data");
      expect(a).toHaveBeenCalledWith("data");
      expect(b).toHaveBeenCalledWith("data");
    });

    it("does not call listeners for other events", () => {
      const listener = vi.fn();
      emitter.on("a", listener);
      emitter.emit("b");
      expect(listener).not.toHaveBeenCalled();
    });

    it("returns true when at least one listener exists", () => {
      emitter.on("evt", vi.fn());
      expect(emitter.emit("evt")).toBe(true);
    });

    it("returns false when no listeners exist for the event", () => {
      expect(emitter.emit("missing")).toBe(false);
    });

    it("returns this from on() for chaining", () => {
      const result = emitter.on("evt", vi.fn());
      expect(result).toBe(emitter);
    });
  });

  describe("off / removeListener", () => {
    it("removes a specific listener", () => {
      const listener = vi.fn();
      emitter.on("evt", listener);
      emitter.off("evt", listener);
      emitter.emit("evt");
      expect(listener).not.toHaveBeenCalled();
    });

    it("does not affect other listeners on the same event", () => {
      const keep = vi.fn();
      const remove = vi.fn();
      emitter.on("evt", keep);
      emitter.on("evt", remove);
      emitter.off("evt", remove);
      emitter.emit("evt");
      expect(keep).toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it("is safe to call off for a non-existent event", () => {
      expect(() => emitter.off("nope", vi.fn())).not.toThrow();
    });

    it("removeListener is an alias for off", () => {
      const listener = vi.fn();
      emitter.on("evt", listener);
      emitter.removeListener("evt", listener);
      emitter.emit("evt");
      expect(listener).not.toHaveBeenCalled();
    });

    it("returns this from off() for chaining", () => {
      const result = emitter.off("evt", vi.fn());
      expect(result).toBe(emitter);
    });
  });

  describe("once", () => {
    it("fires the listener only once", () => {
      const listener = vi.fn();
      emitter.once("evt", listener);
      emitter.emit("evt", "first");
      emitter.emit("evt", "second");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("first");
    });

    it("returns this for chaining", () => {
      const result = emitter.once("evt", vi.fn());
      expect(result).toBe(emitter);
    });
  });

  describe("removeAllListeners", () => {
    it("removes all listeners for a specific event", () => {
      const a = vi.fn();
      const b = vi.fn();
      emitter.on("evt", a);
      emitter.on("evt", b);
      emitter.removeAllListeners("evt");
      expect(emitter.emit("evt")).toBe(false);
    });

    it("does not affect other events", () => {
      const keep = vi.fn();
      emitter.on("keep", keep);
      emitter.on("remove", vi.fn());
      emitter.removeAllListeners("remove");
      emitter.emit("keep");
      expect(keep).toHaveBeenCalled();
    });

    it("clears all events when called without arguments", () => {
      emitter.on("a", vi.fn());
      emitter.on("b", vi.fn());
      emitter.removeAllListeners();
      expect(emitter.emit("a")).toBe(false);
      expect(emitter.emit("b")).toBe(false);
    });

    it("returns this for chaining", () => {
      const result = emitter.removeAllListeners();
      expect(result).toBe(emitter);
    });
  });

  describe("listenerCount", () => {
    it("returns 0 for events with no listeners", () => {
      expect(emitter.listenerCount("nope")).toBe(0);
    });

    it("returns the correct count after adding listeners", () => {
      emitter.on("evt", vi.fn());
      emitter.on("evt", vi.fn());
      expect(emitter.listenerCount("evt")).toBe(2);
    });

    it("decrements after removing a listener", () => {
      const listener = vi.fn();
      emitter.on("evt", listener);
      emitter.on("evt", vi.fn());
      emitter.off("evt", listener);
      expect(emitter.listenerCount("evt")).toBe(1);
    });
  });

  describe("error handling", () => {
    it("catches listener errors and logs to console.error without propagating", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const boom = () => {
        throw new Error("listener exploded");
      };
      const safe = vi.fn();
      emitter.on("evt", boom);
      emitter.on("evt", safe);

      expect(() => emitter.emit("evt")).not.toThrow();
      expect(safe).toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error in event listener for 'evt'"),
        expect.any(Error)
      );
      errSpy.mockRestore();
    });
  });

  describe("duplicate listeners", () => {
    it("does not register the same function reference twice (Set semantics)", () => {
      const listener = vi.fn();
      emitter.on("evt", listener);
      emitter.on("evt", listener);
      emitter.emit("evt");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(emitter.listenerCount("evt")).toBe(1);
    });
  });
});
