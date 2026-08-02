import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  session: { defaultSession: { fetch: vi.fn() } },
}));

import { session } from "electron";

import {
  TwitchPlaylistFetchService,
  twitchPlaylistFetchService,
} from "@/backend/services/twitch-playlist-fetch-service";

// Guards: Twitch playlist HTTP failures are returned as data from main so Chromium never emits a renderer XHR error.
// Guards: Electron session transport is used so configured proxy and session behavior apply to playlist requests.
// Guards: initial and redirected URLs stay inside the HTTPS Twitch m3u8 allowlist.
// Guards: cancelling a request aborts its in-flight Electron session fetch.
describe("TwitchPlaylistFetchService", () => {
  it("uses Electron defaultSession fetch by default", async () => {
    vi.mocked(session.defaultSession.fetch).mockResolvedValueOnce(
      new Response("#EXTM3U", { status: 200 })
    );

    await expect(
      twitchPlaylistFetchService.fetchPlaylist(
        "request-default-session",
        "https://usher.ttvnw.net/api/channel/example.m3u8"
      )
    ).resolves.toEqual({ ok: true, status: 200, text: "#EXTM3U" });
    expect(session.defaultSession.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a Twitch playlist HTTP failure through the injected Electron transport", async () => {
    const sessionFetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const service = new TwitchPlaylistFetchService(sessionFetch);

    await expect(
      service.fetchPlaylist("request-1", "https://usher.ttvnw.net/api/channel/example.m3u8")
    ).resolves.toEqual({ ok: false, status: 404, error: "http" });
    expect(sessionFetch).toHaveBeenCalledWith(
      expect.stringContaining("usher.ttvnw.net"),
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    "http://usher.ttvnw.net/api/channel/example.m3u8",
    "https://ttvnw.net.evil.example/playlist.m3u8",
    "https://usher.ttvnw.net/api/channel/example.json",
  ])("rejects a non-allowlisted URL without fetching: %s", async (url) => {
    const sessionFetch = vi.fn();
    const service = new TwitchPlaylistFetchService(sessionFetch);

    await expect(service.fetchPlaylist("request-1", url)).resolves.toEqual({
      ok: false,
      status: 0,
      error: "invalid-url",
    });
    expect(sessionFetch).not.toHaveBeenCalled();
  });

  it("follows an allowlisted redirect manually", async () => {
    const sessionFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://video-weaver.ttvnw.net/live/index.m3u8" },
        })
      )
      .mockResolvedValueOnce(new Response("#EXTM3U", { status: 200 }));
    const service = new TwitchPlaylistFetchService(sessionFetch);

    await expect(
      service.fetchPlaylist("request-1", "https://usher.ttvnw.net/api/channel/example.m3u8")
    ).resolves.toEqual({ ok: true, status: 200, text: "#EXTM3U" });
    expect(sessionFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect outside the allowlist without requesting it", async () => {
    const sessionFetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/stolen.m3u8" },
      })
    );
    const service = new TwitchPlaylistFetchService(sessionFetch);

    await expect(
      service.fetchPlaylist("request-1", "https://usher.ttvnw.net/api/channel/example.m3u8")
    ).resolves.toEqual({ ok: false, status: 0, error: "invalid-url" });
    expect(sessionFetch).toHaveBeenCalledTimes(1);
  });

  it("aborts the active Electron request when cancelled", async () => {
    let observedSignal: AbortSignal | undefined;
    const sessionFetch = vi.fn((_url: string, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      });
    });
    const service = new TwitchPlaylistFetchService(sessionFetch);
    const resultPromise = service.fetchPlaylist(
      "request-1",
      "https://usher.ttvnw.net/api/channel/example.m3u8"
    );

    expect(service.cancel("request-1")).toBe(true);
    expect(observedSignal?.aborted).toBe(true);
    await expect(resultPromise).resolves.toEqual({ ok: false, status: 0, error: "network" });
  });
});
