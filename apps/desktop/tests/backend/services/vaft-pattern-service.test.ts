import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-store", () => {
  type FakeStoreOptions = {
    defaults: Record<string, unknown> & {
      adPatterns?: Record<string, unknown>;
    };
  };

  return {
    default: class FakeStore {
      private data: Record<string, unknown>;
      constructor(opts: FakeStoreOptions) {
        const defaults = { ...opts.defaults };
        if (defaults.adPatterns) {
          defaults.adPatterns = {
            ...defaults.adPatterns,
            lastChecked: "2020-01-01T00:00:00.000Z",
          };
        }
        this.data = defaults;
      }
      get(key: string) {
        return this.data[key];
      }
      set(key: string, value: unknown) {
        this.data[key] = value;
      }
    },
  };
});

vi.mock("@/lib/managed-interval", () => ({
  createManagedInterval: vi.fn(() => ({ stop: vi.fn() })),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { vaftPatternService } from "@/backend/services/vaft-pattern-service";
import type { AdPatternUpdate } from "@/shared/adblock-types";

function setPrivate(name: string, value: unknown): void {
  Reflect.set(vaftPatternService, name, value);
}

function getPrivate(name: string): unknown {
  return Reflect.get(vaftPatternService, name);
}

function invokePrivate(name: string, ...args: unknown[]): unknown {
  const method = getPrivate(name);
  if (typeof method !== "function") throw new Error(`Missing private test seam: ${name}`);
  return Reflect.apply(method, vaftPatternService, args);
}

function parseVaftScript(script: string): AdPatternUpdate | null {
  const result = invokePrivate("parseVaftScript", script);
  if (result === null) return null;
  if (typeof result !== "object") throw new Error("parseVaftScript returned an invalid result");
  return result as AdPatternUpdate;
}

function parseValidVaftScript(script: string): AdPatternUpdate {
  const result = parseVaftScript(script);
  if (!result) throw new Error("Expected a valid VAFT pattern update");
  return result;
}

function extractDateRangePatterns(script: string): string[] {
  const result = invokePrivate("extractDateRangePatterns", script);
  if (!Array.isArray(result) || !result.every((item) => typeof item === "string")) {
    throw new Error("extractDateRangePatterns returned an invalid result");
  }
  return result;
}

const SAMPLE_VAFT_SCRIPT = `
  var ourTwitchAdSolutionsVersion = 42;
  var AdSignifier = 'stitched';
  var BackupPlayerTypes = ['embed', 'popout-CACHED', 'autoplay'];
  var FallbackPlayerType = 'embed';
  var ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  if (text.includes('stitched-ad')) { return true; }
  if (text.includes('amazon-ad')) { return true; }
`;

function mockFetchResponse(body: string, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    text: () => Promise.resolve(body),
  });
}

describe("VaftPatternService", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setPrivate("isInitialized", false);
    setPrivate("lastCheckTime", 0);
    setPrivate("store", null);
    setPrivate("updateTimer", null);
  });

  afterEach(() => {
    vaftPatternService.destroy();
  });

  describe("initialize", () => {
    it("initializes the store and sets isInitialized", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);

      await vaftPatternService.initialize();

      expect(getPrivate("isInitialized")).toBe(true);
    });

    it("skips double initialization", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();
      const callsAfterFirst = fetchMock.mock.calls.length;

      await vaftPatternService.initialize();
      expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    });
  });

  describe("parseVaftScript", () => {
    it("extracts version number", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      const result = parseValidVaftScript(
        SAMPLE_VAFT_SCRIPT
      );
      expect(result.version).toBe(42);
    });

    it("extracts ad signifiers", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      const result = parseValidVaftScript(
        SAMPLE_VAFT_SCRIPT
      );
      expect(result.adSignifiers).toContain("stitched");
    });

    it("extracts backup player types and deduplicates -CACHED suffix", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      const result = parseValidVaftScript(
        SAMPLE_VAFT_SCRIPT
      );
      expect(result.backupPlayerTypes).toContain("embed");
      expect(result.backupPlayerTypes).toContain("popout");
      expect(result.backupPlayerTypes).toContain("autoplay");
      expect(
        result.backupPlayerTypes.every((t: string) => !t.includes("CACHED"))
      ).toBe(true);
    });

    it("extracts fallback player type", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      const result = parseValidVaftScript(
        SAMPLE_VAFT_SCRIPT
      );
      expect(result.fallbackPlayerType).toBe("embed");
    });

    it("extracts client ID", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      const result = parseValidVaftScript(
        SAMPLE_VAFT_SCRIPT
      );
      expect(result.clientId).toBe("kimne78kx3ncx6brgo4mv6wki5h1ko");
    });

    it("extracts DATERANGE patterns from includes() calls", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      const result = parseValidVaftScript(
        SAMPLE_VAFT_SCRIPT
      );
      expect(result.dateRangePatterns).toContain("stitched-ad");
      expect(result.dateRangePatterns).toContain("amazon-ad");
    });

    it("returns null on malformed script", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      const origExtract = getPrivate("extractDateRangePatterns");
      setPrivate("extractDateRangePatterns", () => {
        throw new Error("parse error");
      });

      const result = parseVaftScript("malformed");
      expect(result).toBeNull();

      setPrivate("extractDateRangePatterns", origExtract);
    });
  });

  describe("fetchAndUpdatePatterns", () => {
    it("rate-limits repeated calls", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();
      const callsAfterInit = fetchMock.mock.calls.length;

      setPrivate("lastCheckTime", Date.now());

      const result = await vaftPatternService.fetchAndUpdatePatterns();
      expect(result).toBeTruthy();
      expect(fetchMock.mock.calls.length).toBe(callsAfterInit);
    });

    it("falls back to backup URL when primary fails", async () => {
      mockFetchResponse("", false, 500);
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain("vaft-ublock-origin.js");
      expect(fetchMock.mock.calls[1][0]).toContain("vaft.user.js");
    });

    it("returns null when both URLs fail", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      setPrivate("lastCheckTime", 0);
      mockFetchResponse("", false, 500);
      mockFetchResponse("", false, 500);

      const result = await vaftPatternService.fetchAndUpdatePatterns();
      expect(result).toBeNull();
    });
  });

  describe("public API", () => {
    beforeEach(async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();
    });

    it("getDateRangePatterns returns patterns", () => {
      const patterns = vaftPatternService.getDateRangePatterns();
      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it("getAdSignifiers returns signifiers", () => {
      const signifiers = vaftPatternService.getAdSignifiers();
      expect(Array.isArray(signifiers)).toBe(true);
      expect(signifiers).toContain("stitched");
    });

    it("getBackupPlayerTypes returns player types", () => {
      const types = vaftPatternService.getBackupPlayerTypes();
      expect(Array.isArray(types)).toBe(true);
    });

    it("getVersion returns version number", () => {
      const version = vaftPatternService.getVersion();
      expect(typeof version).toBe("number");
    });

    it("hasAdDateRange detects ad patterns", () => {
      expect(
        vaftPatternService.hasAdDateRange(
          "#EXT-X-DATERANGE:ID=stitched-ad-123"
        )
      ).toBe(true);
    });

    it("hasAdDateRange returns false for clean text", () => {
      expect(
        vaftPatternService.hasAdDateRange("#EXTINF:2.000,live\nhttps://video-weaver.com/seg.ts")
      ).toBe(false);
    });

    it("hasAdSignifier detects ad signifiers", () => {
      expect(
        vaftPatternService.hasAdSignifier("some stitched content")
      ).toBe(true);
    });

    it("hasAdSignifier returns false for clean text", () => {
      expect(vaftPatternService.hasAdSignifier("clean stream")).toBe(false);
    });

    it("getStats returns structured statistics", () => {
      const stats = vaftPatternService.getStats();
      expect(stats).toHaveProperty("version");
      expect(stats).toHaveProperty("dateRangePatternCount");
      expect(stats).toHaveProperty("signifierCount");
      expect(stats).toHaveProperty("backupPlayerTypeCount");
      expect(stats).toHaveProperty("lastChecked");
      expect(stats).toHaveProperty("autoUpdateEnabled");
    });

    it("setAutoUpdateEnabled toggles auto-update", () => {
      vaftPatternService.setAutoUpdateEnabled(false);
      expect(vaftPatternService.isAutoUpdateEnabled()).toBe(false);

      vaftPatternService.setAutoUpdateEnabled(true);
      expect(vaftPatternService.isAutoUpdateEnabled()).toBe(true);
    });

    it("forceRefresh resets rate limit", async () => {
      setPrivate("lastCheckTime", Date.now());
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);

      await vaftPatternService.forceRefresh();
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("stops the update timer", async () => {
      mockFetchResponse(SAMPLE_VAFT_SCRIPT);
      await vaftPatternService.initialize();

      vaftPatternService.destroy();
      expect(getPrivate("updateTimer")).toBeNull();
    });
  });
});
