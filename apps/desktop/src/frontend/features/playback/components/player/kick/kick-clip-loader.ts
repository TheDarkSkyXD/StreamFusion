/**
 * Custom HLS.js playlist loader for Kick clips.
 *
 * Kick clips are cut from the source stream at an arbitrary point. The first
 * media segment ends up mid-GOP — it carries audio frames but no video
 * keyframe. HLS.js initialises its MediaSource from what it sees in segment 0,
 * so the SourceBuffer ends up audio-only. When segment 1 arrives carrying the
 * video track the MediaSource rejects it and playback never produces a
 * picture.
 *
 * Workaround: intercept the media playlist and strip the first #EXTINF entry
 * before HLS.js parses it. HLS.js then loads the original segment 1 first
 * (which has a keyframe) and MediaSource is initialised with both tracks.
 */

import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderResponse,
  LoaderStats,
  NullableNetworkDetails,
  PlaylistLoaderContext,
} from "hls.js";
import Hls from "hls.js";

import { logger } from "@/renderer/logging/logger";

type PlaylistLoaderConstructor = new (config: HlsConfig) => Loader<PlaylistLoaderContext>;

const KICK_CLIP_SEGMENT_CACHE_BUST = "sf_clip_nocache=1";

export function isKickClipPlaylistUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (!url.includes(".m3u8")) return false;
  if (!/kick\.com/i.test(url)) return false;
  return /\/clips?\//i.test(url);
}

function appendKickClipSegmentCacheBust(uri: string): string {
  if (uri.includes(KICK_CLIP_SEGMENT_CACHE_BUST)) return uri;

  const hashIndex = uri.indexOf("#");
  const beforeHash = hashIndex === -1 ? uri : uri.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : uri.slice(hashIndex);
  const separator = beforeHash.includes("?") ? "&" : "?";

  return `${beforeHash}${separator}${KICK_CLIP_SEGMENT_CACHE_BUST}${hash}`;
}

/**
 * Strip the first segment from a media playlist and bump
 * #EXT-X-MEDIA-SEQUENCE so the remaining segments keep their original
 * sequence numbers. Master playlists (no #EXTINF) pass through unchanged.
 */
function dropFirstSegment(text: string): string {
  if (!text.includes("#EXTINF")) return text;

  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let droppedFirstSegment = false;
  let awaitingSegmentUri = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (awaitingSegmentUri && line && !line.startsWith("#")) {
      out.push(appendKickClipSegmentCacheBust(line));
      awaitingSegmentUri = false;
      i++;
      continue;
    }

    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const match = line.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
      if (match) {
        out.push(`#EXT-X-MEDIA-SEQUENCE:${parseInt(match[1], 10) + 1}`);
        i++;
        continue;
      }
    }

    if (!droppedFirstSegment && line.startsWith("#EXTINF:")) {
      i++;
      // Skip any per-segment tags between #EXTINF and the segment URI
      // (e.g. #EXT-X-BYTERANGE, #EXT-X-PROGRAM-DATE-TIME).
      while (i < lines.length && lines[i].startsWith("#")) {
        i++;
      }
      if (i < lines.length) i++; // skip the segment URI itself
      droppedFirstSegment = true;
      continue;
    }

    out.push(line);
    if (line.startsWith("#EXTINF:")) {
      awaitingSegmentUri = true;
    }
    i++;
  }

  return out.join("\n");
}

export function createKickClipPlaylistLoader(): PlaylistLoaderConstructor {
  const DefaultLoader = Hls.DefaultConfig.loader as unknown as PlaylistLoaderConstructor;

  const KickClipLoader = class extends DefaultLoader implements Loader<PlaylistLoaderContext> {
    load(
      context: PlaylistLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<PlaylistLoaderContext>
    ): void {
      if (!context.url.includes(".m3u8")) {
        super.load(context, config, callbacks);
        return;
      }

      const originalOnSuccess = callbacks.onSuccess;
      callbacks.onSuccess = (
        response: LoaderResponse,
        stats: LoaderStats,
        ctx: PlaylistLoaderContext,
        networkDetails: NullableNetworkDetails
      ) => {
        try {
          if (typeof response.data === "string") {
            const rewritten = dropFirstSegment(response.data);
            originalOnSuccess({ ...response, data: rewritten }, stats, ctx, networkDetails);
            return;
          }
        } catch (err) {
          logger.warn("Player:Kick:ClipLoader", "playlist rewrite failed, passing through", {
            error: err,
          });
        }
        originalOnSuccess(response, stats, ctx, networkDetails);
      };

      super.load(context, config, callbacks);
    }
  };

  return KickClipLoader;
}
