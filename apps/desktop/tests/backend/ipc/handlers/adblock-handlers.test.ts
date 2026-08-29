import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

vi.mock("@backend/services/network-adblock-service", () => ({
  networkAdBlockService: {
    isActive: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock("@backend/services/cosmetic-injection-service", () => ({
  cosmeticInjectionService: {
    isActive: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    injectIntoWebContents: vi.fn(),
  },
}));

vi.mock("@backend/services/twitch-manifest-proxy", () => ({
  twitchManifestProxy: {
    isActive: vi.fn(),
    getStats: vi.fn(),
    clearStreamInfo: vi.fn(),
    clearAllStreamInfos: vi.fn(),
  },
}));

vi.mock("@backend/services/vaft-pattern-service", () => ({
  vaftPatternService: {
    getCurrentPatterns: vi.fn(),
    forceRefresh: vi.fn(),
    getStats: vi.fn(),
    setAutoUpdateEnabled: vi.fn(),
    isAutoUpdateEnabled: vi.fn(),
  },
}));

vi.mock("@backend/logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { BrowserWindow, ipcMain } from "electron";

import { registerAdBlockHandlers } from "@backend/ipc/handlers/adblock-handlers";
import { cosmeticInjectionService } from "@backend/services/cosmetic-injection-service";
import { networkAdBlockService } from "@backend/services/network-adblock-service";
import { twitchManifestProxy } from "@backend/services/twitch-manifest-proxy";
import { vaftPatternService } from "@backend/services/vaft-pattern-service";
import type { AdPatternUpdate } from "@shared/adblock-types";

type Handler = (event: unknown, args?: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return (event, args) => Promise.resolve(Reflect.apply(call[1], undefined, [event, args]));
}

function patterns(version: number): AdPatternUpdate {
  return { version, adSignifiers: ["stitched"], dateRangePatterns: ["ad"], backupPlayerTypes: ["embed"], fallbackPlayerType: "embed", clientId: "client", lastUpdated: "2026-01-01T00:00:00.000Z", source: "test" };
}

const fakeMainWindow = new BrowserWindow();

beforeEach(() => {
  vi.clearAllMocks();
  registerAdBlockHandlers(fakeMainWindow);
});

describe("registerAdBlockHandlers", () => {
  it("registers all adblock IPC channels", () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_GET_STATUS);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_TOGGLE);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_GET_STATS);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_PROXY_STATUS);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_INJECT_COSMETICS);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_STREAM);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_ALL);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_PATTERNS_GET);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_PATTERNS_REFRESH);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_PATTERNS_GET_STATS);
    expect(channels).toContain(IPC_CHANNELS.ADBLOCK_PATTERNS_SET_AUTO_UPDATE);
  });
});

describe("ADBLOCK_GET_STATUS", () => {
  it("returns both service active states", async () => {
    vi.mocked(networkAdBlockService.isActive).mockReturnValue(true);
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_GET_STATUS);
    const result = await handler({});

    expect(result).toEqual({
      networkBlockingEnabled: true,
      cosmeticFilteringEnabled: false,
    });
  });
});

describe("ADBLOCK_TOGGLE", () => {
  it("enables network blocking when network=true", async () => {
    vi.mocked(networkAdBlockService.isActive).mockReturnValue(true);
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_TOGGLE);
    await handler({}, { network: true });

    expect(networkAdBlockService.enable).toHaveBeenCalledTimes(1);
    expect(networkAdBlockService.disable).not.toHaveBeenCalled();
  });

  it("disables network blocking when network=false", async () => {
    vi.mocked(networkAdBlockService.isActive).mockReturnValue(false);
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_TOGGLE);
    await handler({}, { network: false });

    expect(networkAdBlockService.disable).toHaveBeenCalledTimes(1);
    expect(networkAdBlockService.enable).not.toHaveBeenCalled();
  });

  it("enables cosmetic filtering when cosmetic=true", async () => {
    vi.mocked(networkAdBlockService.isActive).mockReturnValue(false);
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(true);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_TOGGLE);
    await handler({}, { cosmetic: true });

    expect(cosmeticInjectionService.enable).toHaveBeenCalledTimes(1);
  });

  it("disables cosmetic filtering when cosmetic=false", async () => {
    vi.mocked(networkAdBlockService.isActive).mockReturnValue(false);
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_TOGGLE);
    await handler({}, { cosmetic: false });

    expect(cosmeticInjectionService.disable).toHaveBeenCalledTimes(1);
  });

  it("does nothing for undefined toggles", async () => {
    vi.mocked(networkAdBlockService.isActive).mockReturnValue(true);
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(true);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_TOGGLE);
    await handler({}, {});

    expect(networkAdBlockService.enable).not.toHaveBeenCalled();
    expect(networkAdBlockService.disable).not.toHaveBeenCalled();
    expect(cosmeticInjectionService.enable).not.toHaveBeenCalled();
    expect(cosmeticInjectionService.disable).not.toHaveBeenCalled();
  });

  it("returns the updated status", async () => {
    vi.mocked(networkAdBlockService.isActive).mockReturnValue(true);
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(false);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_TOGGLE);
    const result = await handler({}, { network: true });

    expect(result).toEqual({
      networkBlockingEnabled: true,
      cosmeticFilteringEnabled: false,
    });
  });
});

describe("ADBLOCK_GET_STATS", () => {
  it("returns stats from networkAdBlockService", async () => {
    const stats = { totalBlocked: 42, byCategory: { ads: 42 }, recentBlocked: [] };
    vi.mocked(networkAdBlockService.getStats).mockReturnValue(stats);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_GET_STATS);
    const result = await handler({});

    expect(result).toBe(stats);
  });
});

describe("ADBLOCK_PROXY_STATUS", () => {
  it("returns proxy active state and stats", async () => {
    vi.mocked(twitchManifestProxy.isActive).mockReturnValue(true);
    const proxyStats = { manifestsProcessed: 10, adsDetected: 2, backupsFetched: 1, segmentsReplaced: 3 };
    vi.mocked(twitchManifestProxy.getStats).mockReturnValue(proxyStats);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PROXY_STATUS);
    const result = await handler({});

    expect(result).toEqual({ isActive: true, stats: proxyStats });
  });
});

describe("ADBLOCK_INJECT_COSMETICS", () => {
  it("injects into the event sender's webContents", async () => {
    const injectionResult = { injected: true, rulesCount: 5 };
    vi.mocked(cosmeticInjectionService.injectIntoWebContents).mockResolvedValue(
      injectionResult
    );
    vi.mocked(cosmeticInjectionService.isActive).mockReturnValue(true);

    const fakeSender = { id: 1 };
    const handler = getHandler(IPC_CHANNELS.ADBLOCK_INJECT_COSMETICS);
    const result = await handler({ sender: fakeSender });

    expect(cosmeticInjectionService.injectIntoWebContents).toHaveBeenCalledWith(fakeSender);
    expect(result).toEqual({
      ...injectionResult,
      cosmeticFilteringEnabled: true,
    });
  });
});

describe("ADBLOCK_PROXY_CLEAR_STREAM", () => {
  it("clears stream info for the given channel", async () => {
    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_STREAM);
    const result = await handler({}, { channelName: "testchannel" });

    expect(twitchManifestProxy.clearStreamInfo).toHaveBeenCalledWith("testchannel");
    expect(result).toEqual({ success: true });
  });
});

describe("ADBLOCK_PROXY_CLEAR_ALL", () => {
  it("clears all stream infos", async () => {
    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PROXY_CLEAR_ALL);
    const result = await handler({});

    expect(twitchManifestProxy.clearAllStreamInfos).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });
});

describe("ADBLOCK_PATTERNS_GET", () => {
  it("returns current patterns", async () => {
    const currentPatterns = patterns(1);
    vi.mocked(vaftPatternService.getCurrentPatterns).mockReturnValue(currentPatterns);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PATTERNS_GET);
    const result = await handler({});

    expect(result).toBe(currentPatterns);
  });
});

describe("ADBLOCK_PATTERNS_REFRESH", () => {
  it("returns success with refreshed patterns", async () => {
    const refreshedPatterns = patterns(2);
    vi.mocked(vaftPatternService.forceRefresh).mockResolvedValue(refreshedPatterns);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PATTERNS_REFRESH);
    const result = await handler({});

    expect(result).toEqual({ success: true, patterns: refreshedPatterns });
  });

  it("returns success=false with fallback patterns when refresh returns null", async () => {
    const fallback = patterns(1);
    vi.mocked(vaftPatternService.forceRefresh).mockResolvedValue(null);
    vi.mocked(vaftPatternService.getCurrentPatterns).mockReturnValue(fallback);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PATTERNS_REFRESH);
    const result = await handler({});

    expect(result).toEqual({ success: false, patterns: fallback });
  });
});

describe("ADBLOCK_PATTERNS_GET_STATS", () => {
  it("returns pattern stats", async () => {
    const stats = { version: 1, dateRangePatternCount: 1, signifierCount: 1, backupPlayerTypeCount: 1, lastChecked: "2026-01-01T00:00:00.000Z", autoUpdateEnabled: true };
    vi.mocked(vaftPatternService.getStats).mockReturnValue(stats);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PATTERNS_GET_STATS);
    const result = await handler({});

    expect(result).toBe(stats);
  });
});

describe("ADBLOCK_PATTERNS_SET_AUTO_UPDATE", () => {
  it("sets auto update and returns current state", async () => {
    vi.mocked(vaftPatternService.isAutoUpdateEnabled).mockReturnValue(true);

    const handler = getHandler(IPC_CHANNELS.ADBLOCK_PATTERNS_SET_AUTO_UPDATE);
    const result = await handler({}, { enabled: true });

    expect(vaftPatternService.setAutoUpdateEnabled).toHaveBeenCalledWith(true);
    expect(result).toEqual({ autoUpdateEnabled: true });
  });
});
