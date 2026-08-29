import { describe, expect, it } from "vitest";
import checkedInProfile from "@backend/search/stream-search-budget-profile.json";
import observations from "../../fixtures/search/stream-search-calibration.observations.json";
import { deriveStreamSearchCalibration } from "../../../scripts/calibrate-stream-search.mjs";

// Guards: checked-in Stream search budgets must be reproducible from real Electron observations, not invented latency/request arrays
describe("Stream search calibration", () => {
  it("reproduces the checked-in calibrated profile from all six Electron observations", () => {
    const regenerated = deriveStreamSearchCalibration(observations, checkedInProfile.generatedAt);
    const { generatedAt: _checkedInTimestamp, ...checkedInComparable } = checkedInProfile;
    const { generatedAt: _regeneratedTimestamp, ...regeneratedComparable } = regenerated;

    expect(observations.observations).toHaveLength(6);
    expect(checkedInProfile).toMatchObject({
      calibrated: true,
      source: "electron-runtime-observations",
      observationCount: 6,
    });
    expect(regeneratedComparable).toEqual(checkedInComparable);
  });

  it("derives all centralized budget dimensions from runtime observations", () => {
    const observation = (platform: "twitch" | "kick", overrides = {}) => ({
      observedAt: "2026-07-17T05:00:00.000Z",
      query: "streamer univer",
      platform,
      latencyMs: 4000,
      requests: 8,
      pages: 2,
      yield: 3,
      pageSize: platform === "twitch" ? 30 : 20,
      concurrency: 2,
      ...overrides,
    });

    const result = deriveStreamSearchCalibration(
      {
        schemaVersion: 1,
        observations: [
          observation("twitch"),
          observation("twitch", { latencyMs: 6000, requests: 10, pages: 3, yield: 6 }),
          observation("kick"),
          observation("kick", { latencyMs: 8000, requests: 12, pages: 4, yield: 5 }),
        ],
      },
      "2026-07-17T06:00:00.000Z"
    );

    expect(result).toEqual({
      schemaVersion: 1,
      calibrated: true,
      source: "electron-runtime-observations",
      observationCount: 4,
      generatedAt: "2026-07-17T06:00:00.000Z",
      budgets: {
        twitch: {
          pageSize: 30,
          maxPages: 4,
          maxRequests: 13,
          maxDurationMs: 8000,
          maxConcurrentRequests: 2,
        },
        kick: {
          pageSize: 20,
          maxPages: 5,
          maxRequests: 15,
          maxDurationMs: 10000,
          maxConcurrentRequests: 2,
        },
      },
    });
  });

  it("refuses to fabricate a Platform profile when observations are missing", () => {
    expect(() =>
      deriveStreamSearchCalibration({
        schemaVersion: 1,
        observations: [
          {
            observedAt: "2026-07-17T05:00:00.000Z",
            query: "streamer univer",
            platform: "twitch",
            latencyMs: 1000,
            requests: 1,
            pages: 1,
            yield: 1,
            pageSize: 30,
            concurrency: 1,
          },
        ],
      })
    ).toThrow("No kick observations were supplied");
  });
});
