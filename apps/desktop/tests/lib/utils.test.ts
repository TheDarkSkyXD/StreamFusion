import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  cn,
  formatDuration,
  formatLanguageLabel,
  formatUptime,
  formatViewerCount,
  getEquivalentCategoryName,
  normalizeCategoryName,
  pickWinner,
} from "@/lib/utils";

describe("cn", () => {
  it("merges simple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes via clsx", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("resolves Tailwind conflicts via tailwind-merge", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("handles undefined and null inputs", () => {
    expect(cn("a", undefined, null, "b")).toBe("a b");
  });
});

describe("formatViewerCount", () => {
  it("returns '0' for undefined", () => {
    expect(formatViewerCount(undefined)).toBe("0");
  });

  it("returns '0' for null", () => {
    expect(formatViewerCount(null)).toBe("0");
  });

  it("returns '0' for 0", () => {
    expect(formatViewerCount(0)).toBe("0");
  });

  it("returns raw number for counts below 1000", () => {
    expect(formatViewerCount(999)).toBe("999");
    expect(formatViewerCount(1)).toBe("1");
    expect(formatViewerCount(500)).toBe("500");
  });

  it("formats thousands as K", () => {
    expect(formatViewerCount(1000)).toBe("1K");
    expect(formatViewerCount(1200)).toBe("1.2K");
    expect(formatViewerCount(25000)).toBe("25K");
    expect(formatViewerCount(999999)).toBe("1000K");
  });

  it("strips trailing .0 in K format", () => {
    expect(formatViewerCount(5000)).toBe("5K");
  });

  it("formats millions as M", () => {
    expect(formatViewerCount(1000000)).toBe("1M");
    expect(formatViewerCount(1500000)).toBe("1.5M");
    expect(formatViewerCount(10000000)).toBe("10M");
  });

  it("strips trailing .0 in M format", () => {
    expect(formatViewerCount(2000000)).toBe("2M");
  });
});

describe("formatDuration", () => {
  it("returns 00:00 for NaN", () => {
    expect(formatDuration(NaN)).toBe("00:00");
  });

  it("returns 00:00 for negative values", () => {
    expect(formatDuration(-1)).toBe("00:00");
    expect(formatDuration(-100)).toBe("00:00");
  });

  it("formats zero seconds", () => {
    expect(formatDuration(0)).toBe("00:00");
  });

  it("formats seconds-only as MM:SS", () => {
    expect(formatDuration(30)).toBe("00:30");
    expect(formatDuration(59)).toBe("00:59");
  });

  it("formats minutes and seconds as MM:SS", () => {
    expect(formatDuration(90)).toBe("01:30");
    expect(formatDuration(330)).toBe("05:30");
  });

  it("formats an hour+ as HH:MM:SS", () => {
    expect(formatDuration(3600)).toBe("01:00:00");
    expect(formatDuration(3661)).toBe("01:01:01");
  });

  it("pads hours to two digits", () => {
    expect(formatDuration(3600 * 4 + 21 * 60 + 10)).toBe("04:21:10");
  });

  it("handles large durations", () => {
    expect(formatDuration(36000)).toBe("10:00:00");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(90.9)).toBe("01:30");
  });
});

describe("formatLanguageLabel", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(formatLanguageLabel(null)).toBe("");
    expect(formatLanguageLabel(undefined)).toBe("");
    expect(formatLanguageLabel("")).toBe("");
  });

  it("resolves BCP-47 codes to display names via Intl", () => {
    expect(formatLanguageLabel("en")).toBe("English");
    expect(formatLanguageLabel("es")).toBe("Spanish");
    expect(formatLanguageLabel("fr")).toBe("French");
  });

  it("title-cases full-word inputs (Kick-style)", () => {
    expect(formatLanguageLabel("english")).toBe("English");
    expect(formatLanguageLabel("SPANISH")).toBe("Spanish");
  });

  it("title-cases unknown long strings", () => {
    expect(formatLanguageLabel("klingon")).toBe("Klingon");
  });
});

describe("normalizeCategoryName", () => {
  it("lowercases plain category names", () => {
    expect(normalizeCategoryName("Just Chatting")).toBe("just chatting");
  });

  it("trims whitespace", () => {
    expect(normalizeCategoryName("  IRL  ")).toBe("irl");
  });

  it("maps Twitch 'Slots & Casino' to the shared key 'slots'", () => {
    expect(normalizeCategoryName("Slots & Casino")).toBe("slots");
  });

  it("maps Kick 'Slots' to the shared key 'slots'", () => {
    expect(normalizeCategoryName("Slots")).toBe("slots");
  });

  it("maps Twitch 'Counter-Strike' and Kick 'Counter-Strike 2' to the same key", () => {
    const twitchKey = normalizeCategoryName("Counter-Strike");
    const kickKey = normalizeCategoryName("Counter-Strike 2");
    expect(twitchKey).toBe(kickKey);
    expect(twitchKey).toBe("counter-strike");
  });

  it("maps asymmetric GTA names to the same key", () => {
    expect(normalizeCategoryName("Grand Theft Auto V")).toBe("grand-theft-auto-v");
    expect(normalizeCategoryName("Grand Theft Auto V (GTA)")).toBe("grand-theft-auto-v");
  });

  it("maps asymmetric Black Desert names to the same key", () => {
    expect(normalizeCategoryName("Black Desert")).toBe("black-desert");
    expect(normalizeCategoryName("Black Desert Online")).toBe("black-desert");
  });
});

describe("getEquivalentCategoryName", () => {
  it("returns the Twitch name for a known key", () => {
    expect(getEquivalentCategoryName("slots", "twitch")).toBe("Slots & Casino");
  });

  it("returns the Kick name for a known key", () => {
    expect(getEquivalentCategoryName("slots", "kick")).toBe("Slots");
  });

  it("returns null for an unknown key", () => {
    expect(getEquivalentCategoryName("just chatting", "twitch")).toBeNull();
    expect(getEquivalentCategoryName("nonexistent", "kick")).toBeNull();
  });

  it("returns correct platform names for every equivalence entry", () => {
    expect(getEquivalentCategoryName("grand-theft-auto-v", "twitch")).toBe("Grand Theft Auto V");
    expect(getEquivalentCategoryName("grand-theft-auto-v", "kick")).toBe(
      "Grand Theft Auto V (GTA)"
    );
    expect(getEquivalentCategoryName("counter-strike", "twitch")).toBe("Counter-Strike");
    expect(getEquivalentCategoryName("counter-strike", "kick")).toBe("Counter-Strike 2");
    expect(getEquivalentCategoryName("black-desert", "twitch")).toBe("Black Desert");
    expect(getEquivalentCategoryName("black-desert", "kick")).toBe("Black Desert Online");
  });
});

describe("pickWinner", () => {
  it("returns 'kick' for 'slots'", () => {
    expect(pickWinner("slots")).toBe("kick");
  });

  it("returns 'twitch' for everything else", () => {
    expect(pickWinner("just chatting")).toBe("twitch");
    expect(pickWinner("counter-strike")).toBe("twitch");
    expect(pickWinner("grand-theft-auto-v")).toBe("twitch");
    expect(pickWinner("irl")).toBe("twitch");
  });
});

describe("formatUptime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0:00:00 for undefined/null", () => {
    expect(formatUptime(undefined)).toBe("0:00:00");
    expect(formatUptime(null)).toBe("0:00:00");
  });

  it("returns 0:00:00 for empty string", () => {
    expect(formatUptime("")).toBe("0:00:00");
  });

  it("formats a 1-hour stream correctly", () => {
    expect(formatUptime("2025-06-01T11:00:00Z")).toBe("1:00:00");
  });

  it("formats minutes and seconds with padding", () => {
    expect(formatUptime("2025-06-01T11:54:30Z")).toBe("0:05:30");
  });

  it("returns 0:00:00 for future dates", () => {
    expect(formatUptime("2025-06-01T13:00:00Z")).toBe("0:00:00");
  });

  it("produces a valid uptime string for YYYY-MM-DD HH:MM:SS input", () => {
    // This format is parsed by some engines as local time and by others as
    // invalid (triggering the UTC-regex fallback). Either way it must not
    // throw and must return a string matching H:MM:SS.
    const result = formatUptime("2025-05-31 12:00:00");
    expect(result).toMatch(/^\d+:\d{2}:\d{2}$/);
  });

  it("returns 0:00:00 for completely invalid dates", () => {
    expect(formatUptime("not-a-date")).toBe("0:00:00");
  });
});
