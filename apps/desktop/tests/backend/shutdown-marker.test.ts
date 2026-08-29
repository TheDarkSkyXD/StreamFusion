import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  writeFileSync: mocks.writeFileSync,
  existsSync: mocks.existsSync,
  unlinkSync: mocks.unlinkSync,
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/fake/userData" },
}));

import { markCleanShutdown, markSessionStarted, wasCleanShutdown } from "@backend/shutdown-marker";

describe("shutdown-marker", () => {
  describe("markCleanShutdown", () => {
    it("writes a file to the userData/.clean-shutdown path", () => {
      mocks.writeFileSync.mockClear();
      markCleanShutdown();
      expect(mocks.writeFileSync).toHaveBeenCalledOnce();
      const [path, content] = mocks.writeFileSync.mock.calls[0];
      expect(path).toContain(".clean-shutdown");
      expect(typeof content).toBe("string");
    });

    it("does not throw when writeFileSync fails", () => {
      mocks.writeFileSync.mockImplementationOnce(() => {
        throw new Error("disk full");
      });
      expect(() => markCleanShutdown()).not.toThrow();
    });
  });

  describe("wasCleanShutdown", () => {
    it("returns true when the marker file exists", () => {
      mocks.existsSync.mockReturnValueOnce(true);
      expect(wasCleanShutdown()).toBe(true);
    });

    it("returns false when the marker file does not exist", () => {
      mocks.existsSync.mockReturnValueOnce(false);
      expect(wasCleanShutdown()).toBe(false);
    });

    it("returns false when existsSync throws", () => {
      mocks.existsSync.mockImplementationOnce(() => {
        throw new Error("permission denied");
      });
      expect(wasCleanShutdown()).toBe(false);
    });
  });

  describe("markSessionStarted", () => {
    it("removes the marker file when it exists", () => {
      mocks.existsSync.mockReturnValueOnce(true);
      mocks.unlinkSync.mockClear();
      markSessionStarted();
      expect(mocks.unlinkSync).toHaveBeenCalledOnce();
      expect(mocks.unlinkSync.mock.calls[0][0]).toContain(".clean-shutdown");
    });

    it("does nothing when the marker file does not exist", () => {
      mocks.existsSync.mockReturnValueOnce(false);
      mocks.unlinkSync.mockClear();
      markSessionStarted();
      expect(mocks.unlinkSync).not.toHaveBeenCalled();
    });

    it("does not throw when unlinkSync fails", () => {
      mocks.existsSync.mockReturnValueOnce(true);
      mocks.unlinkSync.mockImplementationOnce(() => {
        throw new Error("permission denied");
      });
      expect(() => markSessionStarted()).not.toThrow();
    });
  });

  describe("path consistency", () => {
    it("all operations target the same .clean-shutdown path", () => {
      mocks.writeFileSync.mockClear();
      mocks.existsSync.mockClear();
      mocks.unlinkSync.mockClear();
      mocks.existsSync.mockReturnValue(true);

      markCleanShutdown();
      wasCleanShutdown();
      markSessionStarted();

      const writePath = (mocks.writeFileSync.mock.calls[0] as unknown[])[0] as string;
      const existsPath = (mocks.existsSync.mock.calls[0] as unknown[])[0] as string;
      const unlinkPath = (mocks.unlinkSync.mock.calls[0] as unknown[])[0] as string;
      expect(writePath).toBe(existsPath);
      expect(existsPath).toBe(unlinkPath);
    });
  });
});
