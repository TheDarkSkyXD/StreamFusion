import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTwitchPlaylistAdDetector,
  fingerprintTwitchPlaylist,
} from "@/features/playback/utils/twitch-playlist-ad-detection";

const fixtureDirectory = resolve(__dirname, "fixtures/twitch-playlists");

function fixture(name: string): string {
  return readFileSync(resolve(fixtureDirectory, name), "utf8");
}

// Guards: ordinary playlist progression remains confidently clean and refreshes its own baseline.
describe("Twitch playlist ad detection", () => {
  it("keeps ordinary playlist progression clean", () => {
    const detector = createTwitchPlaylistAdDetector();

    const first = detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"));
    const second = detector.analyze("channel-a:source", fixture("clean-progression-002.m3u8"));

    expect(first.verdict).toBe("clean");
    expect(first.hasAds).toBe(false);
    expect(second.verdict).toBe("clean");
    expect(second.diagnostic.baselineFingerprint).toBe(first.diagnostic.fingerprint);
  });

  it("classifies a known ad DATERANGE marker", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-daterange.m3u8"), {
      dateRangePatterns: ["stitched-ad", "com.twitch.tv/ad"],
      adSignifiers: ["stitched"],
    });

    expect(result.hasAds).toBe(true);
    expect(result.verdict).toBe("ad");
    expect(result.reasons).toContain("ad-daterange");
  });

  it("observes a clean discontinuity without classifying an ad", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("clean-discontinuity.m3u8"));

    expect(result.hasAds).toBe(false);
    expect(result.verdict).toBe("clean");
    expect(result.signals).toContainEqual({ reason: "discontinuity", weight: 20 });
  });

  it("classifies a cue-out marker as an ad", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-cue-out.m3u8"));

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toContain("cue-out");
  });

  it("classifies an SCTE-35 splice marker as an ad", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-scte35.m3u8"));

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toContain("scte35");
  });

  it("classifies a known ad segment host and path", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-segment-host.m3u8"));

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toContain("ad-host");
    expect(JSON.stringify(result.diagnostic)).not.toContain("cloudfront.net");
  });

  it("classifies an exact known ad host even when its path is opaque", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-exact-host-only.m3u8"));

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toContain("ad-host");
  });

  it("classifies a known ad segment host carried by a Twitch prefetch tag", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-prefetch-segment-host.m3u8"));

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toContain("ad-host");
    expect(result.diagnostic.hostFingerprints).toHaveLength(1);
    expect(JSON.stringify(result.diagnostic)).not.toContain("cloudfront.net");
  });

  it("preserves contextual stitched-signifier detection", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-signifier.m3u8"), {
      adSignifiers: ["stitched"],
    });

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toContain("signifier");
  });

  it("classifies a mutated DATERANGE value through its known ad attribute", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("ad-mutated-daterange.m3u8"));

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toContain("ad-daterange");
  });

  it("reports a bitrate drop as suspected without blocking", () => {
    const detector = createTwitchPlaylistAdDetector();

    const result = detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"), {
      bitrate: { previous: 6_000_000, current: 1_000_000, dropThreshold: 0.7 },
    });

    expect(result.hasAds).toBe(false);
    expect(result.verdict).toBe("suspected");
    expect(result.reasons).toContain("bitrate-drop");
  });

  it("keeps an isolated sequence transition suspected and non-blocking", () => {
    const detector = createTwitchPlaylistAdDetector();
    const clean = detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"));

    const result = detector.analyze(
      "channel-a:source",
      fixture("suspected-sequence-transition.m3u8")
    );
    const recovery = detector.analyze("channel-a:source", fixture("clean-progression-002.m3u8"));

    expect(result.hasAds).toBe(false);
    expect(result.verdict).toBe("suspected");
    expect(result.reasons).toEqual(["sequence-transition"]);
    expect(recovery.diagnostic.baselineFingerprint).toBe(clean.diagnostic.fingerprint);
  });

  it("keeps an isolated timing transition suspected and non-blocking", () => {
    const detector = createTwitchPlaylistAdDetector();
    const clean = detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"));

    const result = detector.analyze(
      "channel-a:source",
      fixture("suspected-timing-transition.m3u8")
    );
    const recovery = detector.analyze("channel-a:source", fixture("clean-progression-002.m3u8"));

    expect(result.hasAds).toBe(false);
    expect(result.verdict).toBe("suspected");
    expect(result.reasons).toEqual(["timing-transition"]);
    expect(recovery.diagnostic.baselineFingerprint).toBe(clean.diagnostic.fingerprint);
  });

  it("keeps an isolated host transition suspected and non-blocking", () => {
    const detector = createTwitchPlaylistAdDetector();
    const clean = detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"));

    const result = detector.analyze("channel-a:source", fixture("suspected-host-transition.m3u8"));
    const recovery = detector.analyze("channel-a:source", fixture("clean-progression-002.m3u8"));

    expect(result.hasAds).toBe(false);
    expect(result.verdict).toBe("suspected");
    expect(result.reasons).toEqual(["host-transition"]);
    expect(recovery.diagnostic.baselineFingerprint).toBe(clean.diagnostic.fingerprint);
  });

  it("classifies a marker-free splice when weak transition evidence corroborates", () => {
    const detector = createTwitchPlaylistAdDetector();
    detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"));

    const result = detector.analyze("channel-a:source", fixture("ad-splice-transition.m3u8"));

    expect(result.hasAds).toBe(true);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "discontinuity",
        "host-transition",
        "sequence-transition",
        "timing-transition",
      ])
    );
  });

  it("keeps ad and suspected playlists from replacing the clean baseline", () => {
    const detector = createTwitchPlaylistAdDetector();
    const clean = detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"));
    detector.analyze("channel-a:source", fixture("ad-daterange.m3u8"), {
      dateRangePatterns: ["stitched-ad"],
    });
    detector.analyze("channel-a:source", fixture("clean-progression-002.m3u8"), {
      bitrate: { previous: 6_000_000, current: 1_000_000, dropThreshold: 0.7 },
    });

    const recovery = detector.analyze("channel-a:source", fixture("recovery-clean.m3u8"));

    expect(recovery.verdict).toBe("clean");
    expect(recovery.diagnostic.baselineFingerprint).toBe(clean.diagnostic.fingerprint);
  });

  it("isolates clean baselines across channels and variants", () => {
    const detector = createTwitchPlaylistAdDetector();
    detector.analyze("channel-a:source", fixture("clean-progression-001.m3u8"));

    const otherChannel = detector.analyze(
      "channel-b:source",
      fixture("clean-progression-002.m3u8")
    );
    const otherVariant = detector.analyze("channel-a:720p", fixture("clean-progression-002.m3u8"));

    expect(otherChannel.diagnostic.baselineFingerprint).toBeUndefined();
    expect(otherVariant.diagnostic.baselineFingerprint).toBeUndefined();
  });

  it("produces a deterministic structural artifact without raw playlist identity", () => {
    const raw = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:42
#EXT-X-DATERANGE:ID="private-break-id",CLASS="unknown"
#EXTINF:2.000,live
https://private-user.host.example/full/private/channel/path/segment.ts?token=secret-token`;
    const mutatedIdentity = raw
      .replace("private-break-id", "different-private-id")
      .replace("segment.ts?token=secret-token", "other.ts?token=other-secret");

    const first = fingerprintTwitchPlaylist(raw);
    const second = fingerprintTwitchPlaylist(mutatedIdentity);
    const serialized = JSON.stringify(first);

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(serialized).not.toMatch(/private|secret|channel|segment\.ts|host\.example/);
  });

  it("creates a non-mutating reported-miss fixture with an explicit baseline outcome", () => {
    const detector = createTwitchPlaylistAdDetector();
    const clean = detector.analyze("private-channel:source", fixture("clean-progression-001.m3u8"));
    const reportedMiss = detector.createReportedMissFixture(
      "private-channel:source",
      fixture("clean-progression-002.m3u8")
    );
    const recovery = detector.analyze("private-channel:source", fixture("recovery-clean.m3u8"));
    const serialized = JSON.stringify(reportedMiss);

    expect(reportedMiss.captureKind).toBe("reported-miss");
    expect(reportedMiss.baselineComparison).toBe("consistent");
    expect(reportedMiss.baselineFingerprint).toBe(clean.diagnostic.fingerprint);
    expect(recovery.diagnostic.baselineFingerprint).toBe(clean.diagnostic.fingerprint);
    expect(serialized).not.toMatch(/private-channel|video-weaver|token=/);
  });
});
