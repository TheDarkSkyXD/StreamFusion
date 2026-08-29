import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADBLOCK_DEVICE_ID_STORAGE_KEY,
  generateAdBlockDeviceId,
  getAdBlockDeviceId,
  randomizeAdBlockDeviceId,
} from "@/features/playback/components/player/twitch/twitch-adblock-device-id";

describe("twitch-adblock-device-id", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("generateAdBlockDeviceId", () => {
    it("generates a 32-character string", () => {
      const id = generateAdBlockDeviceId();
      expect(id).toHaveLength(32);
    });

    it("contains only lowercase letters and digits", () => {
      const id = generateAdBlockDeviceId();
      expect(id).toMatch(/^[a-z0-9]{32}$/);
    });

    it("generates unique IDs on each call", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateAdBlockDeviceId());
      }
      expect(ids.size).toBeGreaterThan(90);
    });
  });

  describe("getAdBlockDeviceId", () => {
    it("returns null when no device ID is stored", () => {
      expect(getAdBlockDeviceId()).toBeNull();
    });

    it("returns stored device ID", () => {
      localStorage.setItem(ADBLOCK_DEVICE_ID_STORAGE_KEY, "abc123");
      expect(getAdBlockDeviceId()).toBe("abc123");
    });
  });

  describe("randomizeAdBlockDeviceId", () => {
    it("generates and stores a new device ID", () => {
      const newId = randomizeAdBlockDeviceId();
      expect(newId).toHaveLength(32);
      expect(localStorage.getItem(ADBLOCK_DEVICE_ID_STORAGE_KEY)).toBe(newId);
    });

    it("replaces existing device ID", () => {
      localStorage.setItem(ADBLOCK_DEVICE_ID_STORAGE_KEY, "old-device-id");
      const newId = randomizeAdBlockDeviceId();
      expect(newId).not.toBe("old-device-id");
      expect(localStorage.getItem(ADBLOCK_DEVICE_ID_STORAGE_KEY)).toBe(newId);
    });

    it("clears old ID before storing new one", () => {
      localStorage.setItem(ADBLOCK_DEVICE_ID_STORAGE_KEY, "old-id");
      const spy = vi.spyOn(Storage.prototype, "removeItem");

      randomizeAdBlockDeviceId();

      expect(spy).toHaveBeenCalledWith(ADBLOCK_DEVICE_ID_STORAGE_KEY);
      spy.mockRestore();
    });

    it("returns different IDs on successive calls", () => {
      const id1 = randomizeAdBlockDeviceId();
      const id2 = randomizeAdBlockDeviceId();
      // Statistically extremely unlikely to be equal with 36^32 possibilities
      expect(id1).not.toBe(id2);
    });
  });

  describe("ADBLOCK_DEVICE_ID_STORAGE_KEY", () => {
    it("has the expected value", () => {
      expect(ADBLOCK_DEVICE_ID_STORAGE_KEY).toBe("twitch_adblock_device_id");
    });
  });
});
