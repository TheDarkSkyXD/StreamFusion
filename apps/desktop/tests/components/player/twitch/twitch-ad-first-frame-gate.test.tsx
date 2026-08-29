import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoaderResponse } from "hls.js";

const { loggerDebug, loggerError, transportLoad } = vi.hoisted(() => ({
  loggerDebug: vi.fn(),
  loggerError: vi.fn(),
  transportLoad: vi.fn(),
}));

vi.mock("hls.js", () => {
  class DefaultLoader {
    abort() {}
    destroy() {}
    load(...args: unknown[]) {
      transportLoad(...args);
    }
    context: unknown = null;
    stats = {};
  }

  return {
    default: class FakeHls {
      static DefaultConfig = { loader: DefaultLoader };
      static isSupported() {
        return true;
      }
      static Events = {
        MANIFEST_PARSED: "hlsManifestParsed",
        LEVEL_SWITCHED: "hlsLevelSwitched",
        LEVEL_LOADED: "hlsLevelLoaded",
        ERROR: "hlsError",
        MEDIA_ATTACHED: "hlsMediaAttached",
        FRAG_LOADED: "hlsFragLoaded",
        FRAG_BUFFERED: "hlsFragBuffered",
        BUFFER_FLUSHING: "hlsBufferFlushing",
      };
      static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
      static ErrorDetails = { MANIFEST_LOAD_ERROR: "manifestLoadError" };

      config = { backBufferLength: 30 };
      levels = [];
      currentLevel = -1;
      loadSource() {}
      attachMedia() {}
      off() {}
      destroy() {}
      startLoad() {}
      stopLoad() {}
      recoverMediaError() {}
      trigger() {}
      on() {}
    },
  };
});

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: loggerDebug, warn: vi.fn(), error: loggerError },
}));

import {
  clearStreamInfo,
  getAdBlockStatus,
  initAdBlockService,
  processMasterPlaylist,
  processMediaPlaylist,
} from "@/features/playback/components/player/twitch/twitch-adblock-service";
import {
  createAdBlockFragmentLoader,
  createAdBlockPlaylistLoader,
} from "@/features/playback/components/player/twitch/twitch-adblock-loader";
import { TwitchHlsPlayer } from "@/features/playback/components/player/twitch/twitch-hls-player";

const CHANNEL = "firstframechannel";
const MEDIA_URL = "https://video-weaver.redacted.ttvnw.net/v1/playlist/1080p60.m3u8?token=redacted";
const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.4D401F,mp4a.40.2"
${MEDIA_URL}`;

const R6_ORIGIN = "http://localhost:5173";
const R6_RUN_PREFIX = "/__streamfusion-proof/twitch-ad-frame/adframe-20260803-r6";
const R6_MASTER_REQUEST_URL = `${R6_RUN_PREFIX}/usher.ttvnw.net/api/channel/hls/fixtureproof.m3u8`;
const R6_MASTER_RESPONSE_URL = `${R6_ORIGIN}${R6_MASTER_REQUEST_URL}`;
const R6_HIGH_MEDIA_URL = `${R6_ORIGIN}${R6_RUN_PREFIX}/video-edge.ttvnw.net/high.m3u8`;
const R6_LOW_MEDIA_URL = `${R6_ORIGIN}${R6_RUN_PREFIX}/video-edge.ttvnw.net/low.m3u8`;
const R6_MASTER_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=6000000,AVERAGE-BANDWIDTH=5500000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2",NAME="1080p60"
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=220000,AVERAGE-BANDWIDTH=180000,RESOLUTION=284x160,FRAME-RATE=30.000,CODECS="avc1.42C00C,mp4a.40.2",NAME="160p"
${R6_RUN_PREFIX}/video-edge.ttvnw.net/low.m3u8
`;
const R6_CLEAN_LOW_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:10
#EXT-X-DISCONTINUITY-SEQUENCE:1
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T19:00:00.000Z
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/low-clean-10.ts
`;
const R6_HIGH_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:100
#EXT-X-DISCONTINUITY-SEQUENCE:2
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T19:00:00.000Z
#EXT-X-CUE-OUT:8
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high-ad-100.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high-ad-101.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high-ad-102.ts
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high-ad-103.ts
`;
const R8_HIGH_CLEAN_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:10
#EXT-X-DISCONTINUITY-SEQUENCE:1
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T19:00:00.000Z
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high-clean-10.ts
`;
const R8_HIGH_MIDROLL_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:120
#EXT-X-DISCONTINUITY-SEQUENCE:3
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T19:00:00.000Z
#EXT-X-CUE-OUT:8
#EXT-X-DATERANGE:ID="fixture-midroll",CLASS="MIDROLL",START-DATE="2026-08-03T19:00:00.000Z",DURATION=8
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high-ad-120.ts
`;
const R8_HIGH_RECOVERY_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:200
#EXT-X-DISCONTINUITY-SEQUENCE:4
#EXT-X-PROGRAM-DATE-TIME:2026-08-03T19:00:00.000Z
#EXT-X-CUE-IN
#EXT-X-DISCONTINUITY
#EXTINF:2.000,live
${R6_RUN_PREFIX}/video-edge.ttvnw.net/high-clean-200.ts
`;

function readPlaylistFixture(name: string): string {
  return readFileSync(
    resolve(__dirname, `../../../adblock/fixtures/twitch-playlists/${name}.m3u8`),
    "utf8"
  ).replaceAll(
    /https:\/\/([^.]+)\.synthetic\.invalid/g,
    (_match, host: string) => `https://${host}.redacted.ttvnw.net`
  );
}

function firstSegmentReference(playlist: string): string {
  const lines = playlist
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());
  const prefetch = lines.find((line) => line.startsWith("#EXT-X-TWITCH-PREFETCH:"));
  if (prefetch) return prefetch.slice("#EXT-X-TWITCH-PREFETCH:".length);
  return lines.find((line) => line.length > 0 && !line.startsWith("#")) ?? "";
}

async function runFirstFramePipeline(
  fixtureName: string,
  options: { primeWith?: string; originFrame?: string } = {}
): Promise<{
  paintedFrames: string[];
  probes: string[];
  isShowingAd: boolean;
  isVideoShielded: boolean;
  isVideoMuted: boolean;
}> {
  const playlist = readPlaylistFixture(fixtureName);
  const segmentUrl = firstSegmentReference(playlist);
  const originFrame = options.originFrame ?? "ad-frame";
  const probes: string[] = [];
  const paintedFrames: string[] = [];
  let appendedFrame: string | null = null;
  let releaseBackup!: (response: Response) => void;
  const backupGate = new Promise<Response>((resolveGate) => {
    releaseBackup = resolveGate;
  });

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const requestUrl = String(input);
    if (requestUrl === "https://gql.twitch.tv/gql") return backupGate.then((r) => r.clone());
    if (requestUrl === segmentUrl) return new Response(originFrame);
    return new Response("", { status: 503 });
  });

  const rendered = render(
    <TwitchHlsPlayer
      src={`https://usher.ttvnw.net/api/channel/hls/${CHANNEL}.m3u8?token=redacted`}
      channelName={CHANNEL}
      enableAdBlock
      muted={false}
      volume={0.5}
      onAdBlockStatusChange={(status) => {
        if (status.isShowingAd && !probes.includes("classification:blocking")) {
          probes.push("classification:blocking");
        }
      }}
    />
  );
  const video = rendered.container.querySelector("video");
  if (!video) throw new Error("TwitchHlsPlayer did not render a video element");

  await act(async () => {
    await processMasterPlaylist(
      `https://usher.ttvnw.net/api/channel/hls/${CHANNEL}.m3u8?token=redacted`,
      MASTER_PLAYLIST,
      CHANNEL
    );
    if (options.primeWith) {
      await processMediaPlaylist(MEDIA_URL, readPlaylistFixture(options.primeWith));
    }
  });

  transportLoad.mockImplementation((context, _config, callbacks) => {
    const url = String(context.url);
    if (url === MEDIA_URL) {
      void callbacks.onSuccess({ data: playlist }, {}, context, null);
      return;
    }

    const frame = url.startsWith("data:video/mp4") ? "substitute-frame" : originFrame;
    probes.push(`fragment:admitted:${frame}`);
    callbacks.onSuccess({ data: frame }, {}, context, null);
  });

  const sourceBuffer = {
    appendBuffer(frame: string) {
      appendedFrame = frame;
      probes.push(`source-buffer:append:${frame}`);
    },
  };
  const presentAppendedFrame = () => {
    if (video.style.opacity === "0") {
      probes.push(`video:paint-suppressed:${appendedFrame ?? "none"}`);
      return;
    }
    if (appendedFrame) paintedFrames.push(appendedFrame);
    probes.push(`video:present:${appendedFrame ?? "none"}`);
  };

  const PlaylistLoader = createAdBlockPlaylistLoader(CHANNEL);
  const playlistLoader = new PlaylistLoader({} as never);
  let resolvePlaylist!: () => void;
  const playlistReleased = new Promise<void>((resolve) => {
    resolvePlaylist = resolve;
  });

  try {
    await act(async () => {
      playlistLoader.load(
        { url: MEDIA_URL } as never,
        {} as never,
        {
          onSuccess(response: LoaderResponse) {
            probes.push("playlist:released");
            const segmentReference = firstSegmentReference(String(response.data));
            if (!segmentReference) {
              probes.push("fragment:not-admitted");
              resolvePlaylist();
              return;
            }
            const FragmentLoader = createAdBlockFragmentLoader();
            const fragmentLoader = new FragmentLoader({} as never);
            fragmentLoader.load(
              { url: segmentReference } as never,
              {} as never,
              {
                onSuccess(fragmentResponse: LoaderResponse) {
                  sourceBuffer.appendBuffer(String(fragmentResponse.data));
                  presentAppendedFrame();
                  resolvePlaylist();
                },
              } as never
            );
          },
        } as never
      );
      await playlistReleased;
    });
    return {
      paintedFrames,
      probes,
      isShowingAd: getAdBlockStatus(CHANNEL).isShowingAd,
      isVideoShielded: video.style.opacity === "0",
      isVideoMuted: video.muted,
    };
  } finally {
    await act(async () => {
      releaseBackup(new Response("", { status: 503 }));
      await backupGate;
    });
    rendered.unmount();
    clearStreamInfo(CHANNEL);
  }
}

// Guards: a positively classified Twitch ad playlist is reduced to metadata before HLS can admit its first unsafe fragment.
// Guards: Twitch commercial-break interstitial content is opaque unsafe media and cannot reach SourceBuffer before verified clean replacement.
// Guards: fixture-driven timing proves classification and shielding precede playlist release, while unsafe fragment admission and append never occur.
// Guards: a root-relative same-origin master request uses its absolute response URL to register both renditions before unsafe media is held.
describe("Twitch ad first-frame gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
  });

  it("holds a cue-out playlist before HLS can admit its first unsafe frame", async () => {
    const result = await runFirstFramePipeline("ad-cue-out");

    expect(result.probes).toEqual([
      "classification:blocking",
      "playlist:released",
      "fragment:not-admitted",
    ]);
    expect(result.paintedFrames).toEqual([]);
    expect(result.isVideoShielded).toBe(true);
    expect(result.isVideoMuted).toBe(true);
    expect(result.isShowingAd).toBe(true);
  });

  it("suppresses a Twitch commercial-break interstitial before its first frame paints", async () => {
    const interstitialFrame = "twitch-commercial-break-interstitial-frame";
    const result = await runFirstFramePipeline("ad-commercial-break-interstitial", {
      originFrame: interstitialFrame,
    });

    expect(result.probes).toEqual([
      "classification:blocking",
      "playlist:released",
      "fragment:not-admitted",
    ]);
    expect(result.paintedFrames).toEqual([]);
    expect(result.isVideoShielded).toBe(true);
    expect(result.isVideoMuted).toBe(true);
    expect(result.isShowingAd).toBe(true);
  });

  it("routes the r6 root-relative master renditions to the owning player before admission", async () => {
    const proofStatuses: ReturnType<typeof getAdBlockStatus>[] = [];
    const backgroundStatuses: ReturnType<typeof getAdBlockStatus>[] = [];
    const proof = render(
      <TwitchHlsPlayer
        src={R6_MASTER_REQUEST_URL}
        channelName="fixtureproof"
        enableAdBlock
        muted={false}
        volume={0.5}
        onAdBlockStatusChange={(status) => proofStatuses.push(status)}
      />
    );
    const proofVideo = proof.container.querySelector("video");
    if (!proofVideo) throw new Error("fixtureproof did not render a video element");

    const playlistResponses = new Map<string, { data: string; responseUrl: string }>([
      [R6_MASTER_REQUEST_URL, { data: R6_MASTER_PLAYLIST, responseUrl: R6_MASTER_RESPONSE_URL }],
      [R6_LOW_MEDIA_URL, { data: R6_CLEAN_LOW_PLAYLIST, responseUrl: R6_LOW_MEDIA_URL }],
      [R6_HIGH_MEDIA_URL, { data: R6_HIGH_AD_PLAYLIST, responseUrl: R6_HIGH_MEDIA_URL }],
    ]);
    const loadPlaylist = async (
      LoaderClass: ReturnType<typeof createAdBlockPlaylistLoader>,
      url: string,
      onRelease?: (response: LoaderResponse) => void
    ): Promise<LoaderResponse> =>
      new Promise((resolveLoad, rejectLoad) => {
        const loader = new LoaderClass({} as never);
        loader.load(
          { url } as never,
          {} as never,
          {
            onSuccess(response: LoaderResponse) {
              onRelease?.(response);
              resolveLoad(response);
            },
            onError(error: unknown) {
              rejectLoad(error);
            },
          } as never
        );
      });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    transportLoad.mockImplementation((context, _config, callbacks) => {
      const url = String(context.url);
      const response = playlistResponses.get(url);
      if (response === undefined) throw new Error(`No r6 replay response for ${url}`);
      void callbacks.onSuccess(
        { data: response.data, url: response.responseUrl },
        {},
        context,
        null
      );
    });

    const ProofPlaylistLoader = createAdBlockPlaylistLoader("fixtureproof");
    let background: ReturnType<typeof render> | null = null;
    try {
      await act(async () => {
        await loadPlaylist(ProofPlaylistLoader, R6_MASTER_REQUEST_URL);
      });

      const backgroundMasterUrl =
        "https://usher.ttvnw.net/api/channel/hls/theburntpeanut.m3u8?token=redacted";
      const backgroundMediaUrl =
        "https://video-weaver.redacted.ttvnw.net/v1/playlist/theburntpeanut-1080p60.m3u8";
      playlistResponses.set(backgroundMasterUrl, {
        data: `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"\n${backgroundMediaUrl}`,
        responseUrl: backgroundMasterUrl,
      });
      background = render(
        <TwitchHlsPlayer
          src={backgroundMasterUrl}
          channelName="theburntpeanut"
          enableAdBlock
          muted={false}
          onAdBlockStatusChange={(status) => backgroundStatuses.push(status)}
        />
      );
      const backgroundVideo = background.container.querySelector("video");
      if (!backgroundVideo) throw new Error("background Twitch preview did not render a video");
      const BackgroundPlaylistLoader = createAdBlockPlaylistLoader("theburntpeanut");
      await act(async () => {
        await loadPlaylist(BackgroundPlaylistLoader, backgroundMasterUrl);
      });

      let lowOwnershipStatus: ReturnType<typeof getAdBlockStatus> | undefined;
      await act(async () => {
        await loadPlaylist(ProofPlaylistLoader, R6_LOW_MEDIA_URL, () => {
          lowOwnershipStatus = getAdBlockStatus("fixtureproof");
        });
      });

      let releaseBoundary:
        | {
            status: ReturnType<typeof getAdBlockStatus> | undefined;
            opacity: string;
            muted: boolean;
            selectedSegment: string;
          }
        | undefined;
      await act(async () => {
        await loadPlaylist(ProofPlaylistLoader, R6_HIGH_MEDIA_URL, (response) => {
          releaseBoundary = {
            status: proofStatuses.at(-1),
            opacity: proofVideo.style.opacity,
            muted: proofVideo.muted,
            selectedSegment: firstSegmentReference(String(response.data)),
          };
        });
      });

      const processingErrors = loggerError.mock.calls.filter(
        ([scope, message]) =>
          scope === "Player:Twitch:AdblockLoader" && message === "error processing playlist"
      );
      const missingOwnershipUrls = loggerDebug.mock.calls
        .filter(
          ([scope, message]) =>
            scope === "Adblock:TwitchService" &&
            message === "no stream info found for URL, skipping processing"
        )
        .map(([, , details]) => details?.url);

      expect.soft(processingErrors).toEqual([]);
      expect.soft(missingOwnershipUrls).not.toContain(R6_LOW_MEDIA_URL);
      expect.soft(missingOwnershipUrls).not.toContain(R6_HIGH_MEDIA_URL);
      expect
        .soft(lowOwnershipStatus)
        .toEqual(expect.objectContaining({ channelName: "fixtureproof", isShowingAd: false }));
      expect.soft(releaseBoundary).toEqual({
        status: expect.objectContaining({ channelName: "fixtureproof", isShowingAd: true }),
        opacity: "0",
        muted: true,
        selectedSegment: "",
      });
      expect.soft(backgroundVideo.style.opacity).toBe("");
      expect.soft(backgroundVideo.muted).toBe(false);
      expect.soft(backgroundStatuses.every((status) => !status.isShowingAd)).toBe(true);
    } finally {
      background?.unmount();
      proof.unmount();
      clearStreamInfo("theburntpeanut");
      clearStreamInfo("fixtureproof");
    }
  });

  it("ends a DATERANGE midroll on an explicit cue-in despite the recovery sequence jump", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));

    try {
      await processMasterPlaylist(
        R6_MASTER_REQUEST_URL,
        R6_MASTER_PLAYLIST,
        "fixtureproof",
        R6_MASTER_RESPONSE_URL
      );
      await processMediaPlaylist(R6_HIGH_MEDIA_URL, R8_HIGH_CLEAN_PLAYLIST);
      await processMediaPlaylist(R6_HIGH_MEDIA_URL, R8_HIGH_MIDROLL_PLAYLIST);

      expect(getAdBlockStatus("fixtureproof")).toEqual(
        expect.objectContaining({
          isShowingAd: true,
          isMidroll: true,
          isUsingFallbackMode: true,
        })
      );

      await processMediaPlaylist(R6_HIGH_MEDIA_URL, R8_HIGH_RECOVERY_PLAYLIST);

      expect(getAdBlockStatus("fixtureproof")).toEqual(
        expect.objectContaining({
          isShowingAd: false,
          isMidroll: false,
          isStrippingSegments: false,
          numStrippedSegments: 0,
          isUsingFallbackMode: false,
          adStartTime: null,
        })
      );

      loggerDebug.mockClear();
      await processMediaPlaylist(
        R6_HIGH_MEDIA_URL,
        R8_HIGH_RECOVERY_PLAYLIST.replace("MEDIA-SEQUENCE:200", "MEDIA-SEQUENCE:201").replaceAll(
          "high-clean-200.ts",
          "high-clean-201.ts"
        )
      );
      expect(
        loggerDebug.mock.calls.filter(
          ([scope, message]) =>
            scope === "Adblock:TwitchService" && message === "playlist ad classification"
        )
      ).toEqual([]);
    } finally {
      clearStreamInfo("fixtureproof");
    }
  });

  it("keeps blocking when cue-in conflicts with a strong ad marker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    const conflictingPlaylist = R8_HIGH_RECOVERY_PLAYLIST.replace(
      "#EXT-X-CUE-IN",
      "#EXT-X-CUE-IN\n#EXT-X-CUE-OUT:8"
    );

    try {
      await processMasterPlaylist(
        R6_MASTER_REQUEST_URL,
        R6_MASTER_PLAYLIST,
        "fixtureproof",
        R6_MASTER_RESPONSE_URL
      );
      await processMediaPlaylist(R6_HIGH_MEDIA_URL, R8_HIGH_CLEAN_PLAYLIST);
      await processMediaPlaylist(R6_HIGH_MEDIA_URL, R8_HIGH_MIDROLL_PLAYLIST);
      await processMediaPlaylist(R6_HIGH_MEDIA_URL, conflictingPlaylist);

      expect(getAdBlockStatus("fixtureproof")).toEqual(
        expect.objectContaining({
          isShowingAd: true,
          isUsingFallbackMode: true,
        })
      );
    } finally {
      clearStreamInfo("fixtureproof");
    }
  });

  it.each(["#EXT-X-CUE-IN:unexpected", "#EXT-X-CUE-IN-SUFFIX"])(
    "fails closed for malformed cue-in tag %s",
    async (malformedCueIn) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
      const malformedRecovery = R8_HIGH_RECOVERY_PLAYLIST.replace("#EXT-X-CUE-IN", malformedCueIn);

      try {
        await processMasterPlaylist(
          R6_MASTER_REQUEST_URL,
          R6_MASTER_PLAYLIST,
          "fixtureproof",
          R6_MASTER_RESPONSE_URL
        );
        await processMediaPlaylist(R6_HIGH_MEDIA_URL, R8_HIGH_CLEAN_PLAYLIST);
        await processMediaPlaylist(R6_HIGH_MEDIA_URL, R8_HIGH_MIDROLL_PLAYLIST);
        await processMediaPlaylist(R6_HIGH_MEDIA_URL, malformedRecovery);

        expect(getAdBlockStatus("fixtureproof")).toEqual(
          expect.objectContaining({
            isShowingAd: true,
            isMidroll: true,
            isUsingFallbackMode: true,
          })
        );
      } finally {
        clearStreamInfo("fixtureproof");
      }
    }
  );

  it.each([
    ["SCTE-35", "ad-scte35"],
    ["mutated DATERANGE", "ad-mutated-daterange"],
    ["known-host prefetch", "ad-prefetch-segment-host"],
  ])("holds a %s playlist before HLS can admit its first unsafe frame", async (_label, fixtureName) => {
    const result = await runFirstFramePipeline(fixtureName);

    expect(result.probes).toContain("classification:blocking");
    expect(result.probes).toEqual([
      "classification:blocking",
      "playlist:released",
      "fragment:not-admitted",
    ]);
    expect(result.paintedFrames).toEqual([]);
    expect(result.isVideoShielded).toBe(true);
    expect(result.isVideoMuted).toBe(true);
    expect(result.isShowingAd).toBe(true);
  });

  it("holds a marker-free splice after clean playback before its first frame is admitted", async () => {
    const result = await runFirstFramePipeline("ad-splice-transition", {
      primeWith: "clean-progression-001",
    });

    expect(result.probes).toContain("classification:blocking");
    expect(result.probes).toEqual([
      "classification:blocking",
      "playlist:released",
      "fragment:not-admitted",
    ]);
    expect(result.paintedFrames).toEqual([]);
    expect(result.isVideoShielded).toBe(true);
    expect(result.isVideoMuted).toBe(true);
    expect(result.isShowingAd).toBe(true);
  });

  it("admits and presents clean live progression without substitution", async () => {
    const result = await runFirstFramePipeline("clean-progression-001", {
      originFrame: "clean-frame",
    });

    expect(result.probes).toEqual([
      "playlist:released",
      "fragment:admitted:clean-frame",
      "source-buffer:append:clean-frame",
      "video:present:clean-frame",
    ]);
    expect(result.paintedFrames).toEqual(["clean-frame"]);
    expect(result.isVideoShielded).toBe(false);
    expect(result.isVideoMuted).toBe(false);
    expect(result.isShowingAd).toBe(false);
  });
});
