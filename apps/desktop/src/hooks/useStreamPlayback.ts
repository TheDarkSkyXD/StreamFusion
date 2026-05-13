import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { StreamPlayback } from "@/components/player/types";
import type { Platform } from "@/shared/auth-types";

// Maximum reload attempts before giving up (prevents infinite loops)
const MAX_RELOAD_ATTEMPTS = 3;

// Stagger delay between stream initializations in multistream (ms)
// This prevents all streams from hitting Twitch GQL simultaneously
const STAGGER_DELAY_MS = 150;

// Track active hook instances for stagger calculation
let instanceCounter = 0;
const activeInstances = new Map<string, number>();

// Shared playback cache. When the main stream page and the mini-player both
// subscribe to the same channel — which is the common case when the user
// navigates away from a stream — they share a single fetch instead of each
// issuing its own IPC round-trip and (for Kick) racing the BrowserWindow
// mutex. The cache is keyed on `platform:channelName` so two subscribers on
// different channels stay independent.
//
// Lifetime rules:
//   - Coalesce concurrent cold fetches (in-flight dedupe).
//   - Fresh entry served until expiresAt; refCount stays high while
//     subscribers exist so the entry doesn't disappear under them.
//   - Failed fetch evicts the entry immediately so the next subscriber refetches.
//   - When the last subscriber unsubscribes, eviction is deferred by ~1 frame
//     so a fast navigate-away that immediately resubscribes (main page →
//     mini-player) reuses the same fetch instead of starting fresh.
//   - 90 s TTL is well under Kick/Twitch JWT lifetimes (~30-90 min), so the
//     cached URL doesn't outlive its own token in practice.
type CacheEntry = {
  playback: StreamPlayback | null;
  inFlightFetch: Promise<StreamPlayback> | null;
  refCount: number;
  expiresAt: number;
  evictionTimer: ReturnType<typeof setTimeout> | null;
};
const playbackCache = new Map<string, CacheEntry>();
const PLAYBACK_CACHE_TTL_MS = 90_000;
const EVICTION_DEFERRAL_MS = 100;

function getPlaybackCacheKey(platform: Platform, identifier: string): string {
  return `${platform}:${identifier.toLowerCase()}`;
}

async function fetchPlaybackUrlFromBackend(
  platform: Platform,
  identifier: string
): Promise<StreamPlayback> {
  if (!window.electronAPI) {
    throw new Error("Electron API not available");
  }
  const result = await window.electronAPI.streams.getPlaybackUrl({
    platform,
    channelSlug: identifier,
  });
  if (!result.success || !result.data) {
    throw new Error(result.error || "Failed to get stream playback URL");
  }
  return {
    url: result.data.url,
    format: result.data.format as "hls" | "dash" | "mp4",
  };
}

function subscribePlayback(
  platform: Platform,
  identifier: string
): { promise: Promise<StreamPlayback>; release: () => void } {
  const key = getPlaybackCacheKey(platform, identifier);
  let entry = playbackCache.get(key);
  if (!entry) {
    entry = {
      playback: null,
      inFlightFetch: null,
      refCount: 0,
      expiresAt: 0,
      evictionTimer: null,
    };
    playbackCache.set(key, entry);
  }
  // A new subscriber arrived before the deferred eviction fired — cancel it
  // so the cached entry survives.
  if (entry.evictionTimer) {
    clearTimeout(entry.evictionTimer);
    entry.evictionTimer = null;
  }
  entry.refCount++;

  let promise: Promise<StreamPlayback>;
  if (entry.playback && Date.now() < entry.expiresAt) {
    promise = Promise.resolve(entry.playback);
  } else if (entry.inFlightFetch) {
    promise = entry.inFlightFetch;
  } else {
    entry.inFlightFetch = (async () => {
      try {
        const playback = await fetchPlaybackUrlFromBackend(platform, identifier);
        const cur = playbackCache.get(key);
        if (cur) {
          cur.playback = playback;
          cur.expiresAt = Date.now() + PLAYBACK_CACHE_TTL_MS;
          cur.inFlightFetch = null;
        }
        return playback;
      } catch (err) {
        const cur = playbackCache.get(key);
        if (cur) cur.inFlightFetch = null;
        // Failure isn't cached — next subscriber retries fresh so a transient
        // network blip doesn't lock playback out for the full TTL.
        playbackCache.delete(key);
        throw err;
      }
    })();
    promise = entry.inFlightFetch;
  }

  const release = () => {
    const cur = playbackCache.get(key);
    if (!cur) return;
    cur.refCount--;
    if (cur.refCount <= 0 && !cur.evictionTimer) {
      cur.evictionTimer = setTimeout(() => {
        const c = playbackCache.get(key);
        if (c && c.refCount <= 0) playbackCache.delete(key);
      }, EVICTION_DEFERRAL_MS);
    }
  };

  return { promise, release };
}

interface UseStreamPlaybackResult {
  playback: StreamPlayback | null;
  isLoading: boolean;
  error: Error | null;
  reload: () => void;
  /** Whether the current playback URL is using a proxy (Twitch only) */
  isUsingProxy: boolean;
  /** Retry loading the stream without proxy (fallback to direct) */
  retryWithoutProxy: () => void;
  /** Number of consecutive reload attempts (resets on successful playback) */
  reloadAttempts: number;
}

export function useStreamPlayback(platform: Platform, identifier: string): UseStreamPlaybackResult {
  // Unique ID for this hook instance (for staggered loading)
  const instanceId = useId();
  const [playback, setPlayback] = useState<StreamPlayback | null>(null);
  const [isLoading, setIsLoading] = useState(!!identifier);
  const [error, setError] = useState<Error | null>(null);
  const [_reloadKey, setReloadKey] = useState(0);
  // Track if we're using proxy to enable fallback
  const [isUsingProxy, setIsUsingProxy] = useState(false);
  // Force disable proxy for fallback
  const [forceNoProxy, setForceNoProxy] = useState(false);
  // Track reload attempts to prevent infinite loops
  // Use ref for synchronous access in callbacks, state for consumers
  const reloadAttemptsRef = useRef(0);
  const [reloadAttempts, setReloadAttempts] = useState(0);

  const _currentKey = `${platform}-${identifier}`;

  useEffect(() => {
    // Reset all state when stream identifier changes
    setPlayback(null);
    setIsLoading(!!identifier);
    setError(null);
    setIsUsingProxy(false);
    setForceNoProxy(false);
    reloadAttemptsRef.current = 0; // Sync ref
    setReloadAttempts(0); // Reset attempts when stream changes
  }, [identifier]);

  // Register this instance for stagger calculation
  useEffect(() => {
    if (!activeInstances.has(instanceId)) {
      activeInstances.set(instanceId, instanceCounter++);
    }
    return () => {
      activeInstances.delete(instanceId);
    };
  }, [instanceId]);

  useEffect(() => {
    if (!identifier) return;

    let isMounted = true;
    let staggerTimeout: ReturnType<typeof setTimeout> | null = null;
    let release: (() => void) | null = null;

    setIsLoading(true);
    setError(null);

    const fetchUrl = async () => {
      try {
        const sub = subscribePlayback(platform, identifier);
        release = sub.release;
        const newPlayback = await sub.promise;

        if (isMounted) {
          setPlayback(newPlayback);

          // Detect if this is a proxy URL (check for known proxy domains)
          const playbackUrl = newPlayback.url;
          const usingProxy =
            (playbackUrl.includes("cdn-perfprod.com") || playbackUrl.includes("luminous.dev")) &&
            !forceNoProxy;
          console.debug(`[useStreamPlayback] Loaded URL:`, {
            url:
              typeof playbackUrl === "string"
                ? `${playbackUrl.substring(0, 80)}...`
                : "NOT A STRING!",
            isProxy: usingProxy,
            forceNoProxy,
          });
          setIsUsingProxy(usingProxy);
          setIsLoading(false);
          reloadAttemptsRef.current = 0; // Sync ref
          setReloadAttempts(0); // Reset on successful load
        }
      } catch (err) {
        if (isMounted) {
          const error = err instanceof Error ? err : new Error(String(err));
          // "Channel is offline" and "not found" are expected behaviors, not errors - don't log them
          const errorMessageLower = error.message.toLowerCase();
          const isExpectedError =
            errorMessageLower.includes("offline") || errorMessageLower.includes("not found");
          if (!isExpectedError) {
            console.error(`Failed to load stream playback for ${platform}/${identifier}`, err);
          }
          setError(error);
          setIsLoading(false);
        }
      }
    };

    // Calculate stagger delay based on instance order
    // This spreads out API requests when multiple streams load simultaneously
    const instanceOrder = activeInstances.get(instanceId) ?? 0;
    const staggerDelay = instanceOrder * STAGGER_DELAY_MS;

    if (staggerDelay > 0) {
      console.debug(
        `[useStreamPlayback] Staggering ${platform}/${identifier} by ${staggerDelay}ms (instance ${instanceOrder})`
      );
      staggerTimeout = setTimeout(fetchUrl, staggerDelay);
    } else {
      fetchUrl();
    }

    return () => {
      isMounted = false;
      if (staggerTimeout) {
        clearTimeout(staggerTimeout);
      }
      if (release) {
        release();
      }
    };
  }, [platform, identifier, forceNoProxy, instanceId]);

  const retryWithoutProxy = useCallback(() => {
    console.debug("[useStreamPlayback] Retrying without proxy (fallback to direct)");
    setForceNoProxy(true);
    setPlayback(null);
    setError(null);
    setReloadKey((prev) => prev + 1);
  }, []);

  // Reload with rate limiting to prevent infinite loops
  // Uses a ref for synchronous tracking since React state updates are async/batched
  const reload = useCallback(() => {
    if (reloadAttemptsRef.current >= MAX_RELOAD_ATTEMPTS) {
      console.debug(
        `[useStreamPlayback] Max reload attempts (${MAX_RELOAD_ATTEMPTS}) reached, stopping`
      );
      setError(new Error("Max reload attempts reached - stream may be offline"));
      return;
    }
    reloadAttemptsRef.current += 1;
    setReloadAttempts(reloadAttemptsRef.current); // Keep state in sync for consumers
    setReloadKey((prev) => prev + 1);
  }, []);

  return {
    playback,
    isLoading,
    error,
    isUsingProxy,
    reload,
    retryWithoutProxy,
    reloadAttempts,
  };
}
