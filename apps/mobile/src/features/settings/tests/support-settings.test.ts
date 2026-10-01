import { describe, expect, it } from "vitest";

import { interpretGithubReleases } from "../domain/github-release";
import {
  buildLocalReport,
  DEFAULT_SUPPORT_SETTINGS,
  filterSupportLogs,
  mergeSupportSettings,
  parseSupportSettings,
} from "../domain/support-settings";

// Guards: GitHub update checks ignore prereleases and reports stay redacted local copies
describe("support settings domain", () => {
  it("merges patches onto current support settings", () => {
    const merged = mergeSupportSettings(DEFAULT_SUPPORT_SETTINGS, {
      automaticForegroundUpdateChecks: true,
      checkFrequency: "weekly",
      reportDescription: "player stalled",
    });
    expect(merged.automaticForegroundUpdateChecks).toBe(true);
    expect(merged.checkFrequency).toBe("weekly");
    expect(merged.reportDescription).toBe("player stalled");
    expect(merged.attachLogs).toBe(true);
  });

  it("filters logs by minimum level and source", () => {
    const logs = filterSupportLogs(
      [
        { level: "debug", message: "hidden", source: "player" },
        { level: "error", message: "shown", source: "storage" },
        { level: "warn", message: "other", source: "network" },
      ],
      { ...DEFAULT_SUPPORT_SETTINGS, logLevel: "warn", logSource: "storage" },
    );
    expect(logs).toEqual([
      { level: "error", message: "shown", source: "storage" },
    ]);
  });

  it("builds a redacted local report without uploading", () => {
    const report = JSON.parse(
      buildLocalReport({
        installedVersion: "1.0.0",
        logs: [{ level: "info", message: "opened", source: "storage" }],
        preferences: DEFAULT_SUPPORT_SETTINGS,
        profileCopy: "safe profile",
      }),
    ) as { redacted: boolean; profile: string };
    expect(report.redacted).toBe(true);
    expect(report.profile).toBe("safe profile");
  });

  it("parses corrupt JSON as defaults", () => {
    expect(parseSupportSettings("{")).toEqual(DEFAULT_SUPPORT_SETTINGS);
  });
});

describe("github latest release", () => {
  it("chooses the newest Android prerelease instead of a desktop release", () => {
    const release = (tag: string, prerelease = true) => ({
      tag_name: tag,
      prerelease,
      draft: false,
      body: "Player fixes",
      assets: [{
        name: `StreamFusion-${tag}.apk`,
        browser_download_url: `https://github.com/TheDarkSkyXD/StreamFusion/releases/download/${tag}/StreamFusion-${tag}.apk`,
      }],
    });
    const result = interpretGithubReleases({
      installedVersion: "0.1.0-alpha",
      allowPrerelease: true,
      payload: [
        release("v2.0.0", false),
        release("android-v0.1.1-alpha"),
        release("android-v0.1.0-alpha"),
      ],
    });
    expect(result).toMatchObject({
      status: "available",
      release: { version: "0.1.1-alpha", notes: "Player fixes" },
    });
  });
});
