import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from "@/backend/logging/logger";
import {
  installNetworkRequestLogger,
  networkRequestUrlFingerprint,
  recordDevtoolsNetworkRequestHint,
} from "@/backend/logging/network-request-logger";

const loggerMock = vi.mocked(logger);

type Listener<T> = (details: T) => void;

type FakeWebRequest = {
  onSendHeaders: ReturnType<typeof vi.fn>;
  onCompleted: ReturnType<typeof vi.fn>;
  onErrorOccurred: ReturnType<typeof vi.fn>;
};

function makeSession() {
  const webRequest: FakeWebRequest = {
    onSendHeaders: vi.fn(),
    onCompleted: vi.fn(),
    onErrorOccurred: vi.fn(),
  };

  return {
    session: { webRequest },
    webRequest,
  };
}

function listenerAt<T>(fn: ReturnType<typeof vi.fn>): Listener<T> {
  return fn.mock.calls[0]?.[1] as Listener<T>;
}

const signedPlaylistUrl =
  "https://fa723fc1b171.use21.playlist.live-video.net/v1/playlist/Cp0F5ra5zQbiktfvf6ezdYSBEletOK1PLhh54khJkwiRzswmlwbtC7YizjoprBvX2e-2ohv83BZvTRXwTPwp5k3Dxp6quScYuXd4VuW6DAjSFy4jKrj2DBq9Llj2-y2NR0ylcDlEZCteQ5Uhf1mVCjUc97uIzJyHEcqcgmQxtCAjufovcx8fL748MKkepvt2ITP8JAIt3sml3YlTXg836z8aB7A91t64T6wwt0wPNq3snl15S1gEgdQnWov5MEH2MgdcpSLheaOPEjwh1IcIohZpzILvCvLnxyoPcfpbmMzh7BYa6hrX4liGXpIRNSLHdRyz3c_5n4rB_Gxvs371VDUK5o6cAqxYYwhxgP1goY9QlctAiiwJiJyowuTjHVCaE8YIDF01n3jLYrjEmUVJV967qqESLdG3fQel6je8u67pZerm7tvK9ZqFy0E5VRYhoSCTdaL54qOFwBLI_9S--R_At_XuFD352qUQvGUpIKKpKaNzXAeGJchuWucmnb1-2MZqMGo-9KBW_DBnu3kV0f2lGFCANFy8fezxjsIYSKMXE-uhKIhCr2K6se1mDDTWa085tbEOP-K4ysuT0pIpD7-ad6Jc5joj7puhDRZMHXY4K_WAF1uho8gjq_w4ocPwNLYFeD-7ergJlL4CSOejOk4nj0b3f582VojM_JPHBAkoJgG4_Be2zZvSXZWdHexTkhQIBE53xbCyryZsxLRlb2FWSf-mxviR4G25lLcDD_qKrusE95CHp8Mdz_watcSxL6zqVgpYDeuUXQ_WsQAl-ZsuwpcT9eRKl3hsGzPOzKaAWTWdZXiW9Ynn3sV3Fo7AvOpAUFnDnqJhVnz85taax0Ss_aKpuy4LJ3SefLX0TFT6AiugXUkUonU_4MdnybRqGgzd5lWppUjoVdl7ldsgASoJdXMtZWFzdC0yMKgP.m3u8";

function fingerprint(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

// Guards: a retryable HLS segment transport failure is diagnostic noise, not a terminal playback error
describe("installNetworkRequestLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs failed stream playlist requests as real network errors with redacted signed URLs", () => {
    const { session, webRequest } = makeSession();
    installNetworkRequestLogger(session as unknown as Electron.Session);

    listenerAt<Electron.OnSendHeadersListenerDetails>(webRequest.onSendHeaders)({
      id: 7,
      url: signedPlaylistUrl,
      method: "GET",
      resourceType: "xhr",
      referrer: "http://localhost:5173/",
      timestamp: 1000,
      requestHeaders: {
        Authorization: "Bearer secret",
        Referer: "http://localhost:5173/",
        "User-Agent": "StreamFusion/1.0.0-beta.1",
      },
    });

    listenerAt<Electron.OnErrorOccurredListenerDetails>(webRequest.onErrorOccurred)({
      id: 7,
      url: signedPlaylistUrl,
      method: "GET",
      resourceType: "xhr",
      referrer: "http://localhost:5173/",
      timestamp: 4200,
      fromCache: false,
      error: "net::ERR_TIMED_OUT",
    });

    expect(loggerMock.error).toHaveBeenCalledWith(
      "Network:Request",
      "stream request failed",
      expect.objectContaining({
        host: "fa723fc1b171.use21.playlist.live-video.net",
        initiator: "http://localhost:5173/",
        method: "GET",
        name: "[REDACTED].m3u8",
        requestHeaders: {
          Referer: "http://localhost:5173/",
          "User-Agent": "StreamFusion/1.0.0-beta.1",
        },
        resourceType: "xhr",
        kind: "playlist",
        type: "playlist/xhr",
        status: "net::ERR_TIMED_OUT",
        error: "net::ERR_TIMED_OUT",
        fromCache: false,
        durationMs: 3200,
        url: "https://fa723fc1b171.use21.playlist.live-video.net/v1/playlist/[REDACTED].m3u8",
        urlFingerprint: fingerprint(signedPlaylistUrl),
      })
    );

    const meta = loggerMock.error.mock.calls[0]?.[2];
    expect(JSON.stringify(meta)).not.toContain("Cp0F5ra5zQbiktfvf6ezdYSBEletOK1PLhh54khJkwiRz");
    expect(JSON.stringify(meta)).not.toContain("Bearer secret");
  });

  it("logs successful playlist loads for visibility without logging every successful segment", () => {
    const { session, webRequest } = makeSession();
    installNetworkRequestLogger(session as unknown as Electron.Session);

    listenerAt<Electron.OnCompletedListenerDetails>(webRequest.onCompleted)({
      id: 8,
      url: "https://usher.ttvnw.net/api/channel/hls/example.m3u8?token=secret",
      method: "GET",
      resourceType: "xhr",
      referrer: "http://localhost:5173/",
      timestamp: 1200,
      fromCache: false,
      statusCode: 200,
      statusLine: "HTTP/2 200",
      responseHeaders: { "content-length": ["4096"] },
      error: "",
    });

    listenerAt<Electron.OnCompletedListenerDetails>(webRequest.onCompleted)({
      id: 9,
      url: "https://video-weaver.example.ttvnw.net/v1/segment/example.ts",
      method: "GET",
      resourceType: "media",
      referrer: "http://localhost:5173/",
      timestamp: 1300,
      fromCache: false,
      statusCode: 200,
      statusLine: "HTTP/2 200",
      error: "",
    });

    expect(loggerMock.info).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).toHaveBeenCalledWith(
      "Network:Request",
      "stream playlist request completed",
      expect.objectContaining({ sizeBytes: 4096, status: "200", statusCode: 200, kind: "playlist" })
    );
  });

  it("does not register duplicate listeners for the same session", () => {
    const { session, webRequest } = makeSession();
    const electronSession = session as unknown as Electron.Session;

    installNetworkRequestLogger(electronSession);
    installNetworkRequestLogger(electronSession);

    expect(webRequest.onSendHeaders).toHaveBeenCalledTimes(1);
    expect(webRequest.onCompleted).toHaveBeenCalledTimes(1);
    expect(webRequest.onErrorOccurred).toHaveBeenCalledTimes(1);
  });

  it("ignores aborted stream requests because hls.js cancels stale loads during normal playback", () => {
    const { session, webRequest } = makeSession();
    const url =
      "https://fa723fc1b171.use22.playlist.live-video.net/v1/playlist/devtools-hint-token.m3u8";

    recordDevtoolsNetworkRequestHint({
      generatedInitiator: "hls__js.js:27827",
      generatedInitiatorColumn: 9,
      generatedInitiatorLine: 27827,
      generatedInitiatorUrl: "http://localhost:5173/node_modules/.vite/deps/hls__js.js?v=abc",
      initiator: "hls.ts:418",
      initiatorColumn: 12,
      initiatorFunction: "loadPlaylist",
      initiatorLine: 418,
      initiatorType: "script",
      initiatorUrl: "http://localhost:5173/src/player/hls.ts",
      requestHeaders: {
        Authorization: "Bearer secret",
        Referer: "http://localhost:5173/",
      },
      timestamp: 100,
      urlFingerprint: networkRequestUrlFingerprint(url),
    });

    installNetworkRequestLogger(session as unknown as Electron.Session);

    listenerAt<Electron.OnSendHeadersListenerDetails>(webRequest.onSendHeaders)({
      id: 10,
      url,
      method: "GET",
      resourceType: "xhr",
      referrer: "http://localhost:5173/",
      timestamp: 1000,
      requestHeaders: {},
    });

    listenerAt<Electron.OnErrorOccurredListenerDetails>(webRequest.onErrorOccurred)({
      id: 10,
      url,
      method: "GET",
      resourceType: "xhr",
      referrer: "http://localhost:5173/",
      timestamp: 1200,
      fromCache: false,
      error: "net::ERR_ABORTED",
    });

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  it("warns for a failed HLS segment because hls.js can recover by retrying it", () => {
    const { session, webRequest } = makeSession();
    const url =
      "https://fa723fc1b171.cd655df44508.j.cloudfront.hls.live-video.net/v1/segment/example.ts";

    installNetworkRequestLogger(session as unknown as Electron.Session);

    listenerAt<Electron.OnSendHeadersListenerDetails>(webRequest.onSendHeaders)({
      id: 11,
      url,
      method: "GET",
      resourceType: "xhr",
      referrer: "http://localhost:5173/",
      timestamp: 1000,
      requestHeaders: {},
    });

    listenerAt<Electron.OnErrorOccurredListenerDetails>(webRequest.onErrorOccurred)({
      id: 11,
      url,
      method: "GET",
      resourceType: "xhr",
      referrer: "http://localhost:5173/",
      timestamp: 1081,
      fromCache: false,
      error: "net::ERR_FAILED",
    });

    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Network:Request",
      "stream segment request failed; hls.js may retry",
      expect.objectContaining({
        kind: "segment",
        error: "net::ERR_FAILED",
        status: "net::ERR_FAILED",
        durationMs: 81,
      })
    );
  });
});
