import { describe, expect, it } from "vitest";

import { interpretGithubLatestRelease } from "../domain/github-release";
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
  it("ignores prereleases and reports an available stable tag", () => {
    expect(
      interpretGithubLatestRelease({
        installedVersion: "1.0.0-beta.1",
        payload: { prerelease: true, tag_name: "v9.0.0" },
      }).copy,
    ).toMatch(/prerelease/);
    expect(
      interpretGithubLatestRelease({
        installedVersion: "1.0.0-beta.1",
        payload: { prerelease: false, tag_name: "v1.2.0" },
      }).copy,
    ).toMatch(/Stable v1.2.0/);
  });
});
