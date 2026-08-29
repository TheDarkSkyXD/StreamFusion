/**
 * Custom HLS.js Playlist Loader for Twitch Ad-Blocking
 *
 * This loader intercepts m3u8 playlist requests and processes them
 * through the TwitchAdBlockService to remove ads.
 *
 * Usage:
 * ```typescript
 * import Hls from 'hls.js';
 * import { createAdBlockLoader } from './twitch-adblock-loader';
 *
 * const hls = new Hls({
 *     pLoader: createAdBlockLoader(Hls, channelName),
 * });
 * ```
 */

import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderResponse,
  LoaderStats,
  NullableNetworkDetails,
} from "hls.js";
import Hls from "hls.js";

import { logger } from "@/renderer/logging/logger";

import {
  isAdBlockEnabled,
  processMasterPlaylist,
  processMediaPlaylist,
} from "./twitch-adblock-service";

/**
 * Extract channel name from a Twitch usher URL
 */
function extractChannelName(url: string): string | null {
  // Match Twitch's current and legacy usher shapes:
  // /api/channel/{channel}.m3u8 and /api/channel/hls/{channel}.m3u8
  const match = url.match(/\/channel\/(?:hls\/)?([^/.]+)\.m3u8/);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Check if URL is a master playlist (usher URL)
 */
function isMasterPlaylist(url: string): boolean {
  return url.includes("usher.ttvnw.net") && /\/channel\/(?:hls\/)?[^/?#]+\.m3u8/.test(url);
}

/**
 * Check if URL is a media playlist (quality-specific m3u8)
 * Note: Must use includes() not endsWith() because Twitch URLs have query params
 */
function isMediaPlaylist(url: string): boolean {
  return url.includes(".m3u8") && !isMasterPlaylist(url);
}

/**
 * HLS.js loader constructor type
 */
type LoaderConstructor = new (config: HlsConfig) => Loader<LoaderContext>;

function getEffectivePlaylistUrl(
  response: LoaderResponse,
  context: LoaderContext,
  requestUrl: string
): string | null {
  for (const candidate of [response.url, context.url, requestUrl]) {
    if (!candidate) continue;
    try {
      const protocol = new URL(candidate).protocol;
      if (protocol === "http:" || protocol === "https:") return candidate;
    } catch {
      // Try the next already-absolute candidate.
    }
  }
  return null;
}

/**
 * Create an ad-blocking playlist loader for HLS.js
 *
 * This loader ONLY handles .m3u8 playlist files. Segment replacement
 * is handled by the fragment loader (createAdBlockFragmentLoader).
 *
 * @param channelName - Optional channel name (will be extracted from URL if not provided)
 * @returns A loader class that can be used as pLoader in HLS.js config
 */
export function createAdBlockPlaylistLoader(channelName?: string): LoaderConstructor {
  // Get the default loader class
  const DefaultLoader = Hls.DefaultConfig.loader;

  // Store channel name in closure
  let storedChannelName = channelName?.toLowerCase() ?? null;

  // Create a custom loader class that extends DefaultLoader and implements Loader<LoaderContext>
  const AdBlockLoader = class extends DefaultLoader implements Loader<LoaderContext> {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ): void {
      const url: string = context.url;

      // If ad-blocking is disabled, pass through directly
      if (!isAdBlockEnabled()) {
        super.load(context, config, callbacks);
        return;
      }

      // Handle m3u8 playlist processing
      // Note: Must use includes() not endsWith() because Twitch URLs have query params
      if (url.includes(".m3u8")) {
        const originalOnSuccess = callbacks.onSuccess;
        const originalOnError = callbacks.onError;

        // Debug logging for troubleshooting
        // const isMaster = isMasterPlaylist(url);
        // const isMedia = isMediaPlaylist(url);
        // console.debug(
        //   `[AdBlockLoader] Intercepting ${isMaster ? "MASTER" : isMedia ? "MEDIA" : "UNKNOWN"} playlist`
        // );

        callbacks.onSuccess = async (
          response: LoaderResponse,
          stats: LoaderStats,
          ctx: LoaderContext,
          networkDetails: NullableNetworkDetails
        ) => {
          try {
            // Only process if we have text data
            if (typeof response.data === "string") {
              const effectiveUrl = getEffectivePlaylistUrl(response, ctx, url);
              if (!effectiveUrl) {
                originalOnError(
                  {
                    code: 0,
                    text: "Twitch ad-block playlist processing requires an absolute HTTP(S) base URL",
                  },
                  ctx,
                  networkDetails,
                  stats
                );
                return;
              }
              let processedData = response.data;

              if (isMasterPlaylist(url)) {
                const channel = storedChannelName ?? extractChannelName(url);
                if (channel) {
                  storedChannelName = channel;
                  processedData = await processMasterPlaylist(
                    url,
                    response.data,
                    channel,
                    effectiveUrl
                  );
                }
              } else if (isMediaPlaylist(url)) {
                processedData = await processMediaPlaylist(
                  effectiveUrl,
                  response.data,
                  storedChannelName ?? undefined
                );
              }

              originalOnSuccess({ ...response, data: processedData }, stats, ctx, networkDetails);
            } else {
              // Non-text response (shouldn't happen for m3u8), pass through
              originalOnSuccess(response, stats, ctx, networkDetails);
            }
          } catch (error) {
            logger.error("Player:Twitch:AdblockLoader", "error processing playlist", {
              error: error instanceof Error ? error.message : String(error),
            });
            originalOnError(
              { code: 0, text: "Twitch ad-block playlist processing failed closed" },
              ctx,
              networkDetails,
              stats
            );
          }
        };
      }

      // Load with potentially modified callbacks
      super.load(context, config, callbacks);
    }
  };

  return AdBlockLoader as LoaderConstructor;
}

/**
 * Create a transparent fragment loader.
 *
 * Ad replacement happens at playlist level with a real clean Twitch
 * rendition. Feeding HLS.js a synthetic media fragment causes decoder
 * failures and an unbounded retry loop, so fragment bytes are never
 * substituted here.
 */
export function createAdBlockFragmentLoader(): LoaderConstructor {
  const DefaultLoader = Hls.DefaultConfig.loader;

  const AdBlockFragmentLoader = class extends DefaultLoader implements Loader<LoaderContext> {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ): void {
      super.load(context, config, callbacks);
    }
  };

  return AdBlockFragmentLoader as LoaderConstructor;
}

/**
 * HLS.js configuration options with ad-blocking enabled
 *
 * Use this helper to get HLS config with ad-blocking loaders
 */
export interface AdBlockHlsConfig {
  pLoader: LoaderConstructor;
  fLoader: LoaderConstructor;
}

/**
 * Get HLS.js config with ad-blocking loaders
 */
export function getAdBlockHlsConfig(channelName?: string): AdBlockHlsConfig {
  return {
    pLoader: createAdBlockPlaylistLoader(channelName),
    fLoader: createAdBlockFragmentLoader(),
  };
}
