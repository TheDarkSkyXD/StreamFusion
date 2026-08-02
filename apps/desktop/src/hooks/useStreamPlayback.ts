import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { StreamPlayback } from "@/components/player/types";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@/shared/auth-types";

// Maximum reload attempts before giving up (prevents infinite loops)
const MAX_RELOAD_ATTEMPTS = 3;

// Stagger delay between stream initializations in multistream (ms)
// This prevents all streams from hitting Twitch GQL simultaneously
const STAGGER_DELAY_MS = 150;

// Track active hook instances for stagger calculation. Hidden/empty instances
// must not consume an order slot, otherwise the always-mounted mini-player can
// delay the first visible stream on startup.
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
const playbackReloadListeners = new Map<string, Set<() => void>>();
const playbackPrefetchFailures = new Map<string, number>();
const PLAYBACK_CACHE_TTL_MS = 90_000;
const PREFETCH_FAILURE_TTL_MS = 30_000;
const EVICTION_DEFERRAL_MS = 100;
let playbackRequestCounter = 0;

function getPlaybackCacheKey(platform: Platform, identifier: string): string {
  return `${platform}:${identifier.toLowerCase()}`;
}

function requestSharedPlaybackReload(key: string): void {
  playbackCache.delete(key);
  playbackReloadListeners.get(key)?.forEach((listener) => listener());
}

function summarizePlaybackUrl(url: string): { urlHost: string | null; formatHint: string | null } {
  try {
    const parsed = new URL(url);
    return {
      urlHost: parsed.host,
      formatHint: parsed.pathname.split(".").pop() ?? null,
    };
  } catch {
    return { urlHost: null, formatHint: null };
  }
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

function startPlaybackFetch(
  key: string,
  entry: CacheEntry,
  traceId: string,
  platform: Platform,
  identifier: string,
  cacheSource: "network" | "prefetch"
): Promise<StreamPlayback> {
  const fetchStartedAt = Date.now();
  entry.inFlightFetch = (async () => {
    try {
      const playback = await fetchPlaybackUrlFromBackend(platform, identifier);
      const cur = playbackCache.get(key);
      if (cur) {
        cur.playback = playback;
        cur.expiresAt = Date.now() + PLAYBACK_CACHE_TTL_MS;
        cur.inFlightFetch = null;
      }
      playbackPrefetchFailures.delete(key);
      logger.info("Hook:StreamPlayback", "playback URL ready", {
        traceId,
        platform,
        identifier,
        cacheSource,
        durationMs: Date.now() - fetchStartedAt,
        ...summarizePlaybackUrl(playback.url),
      });
      return playback;
    } catch (err) {
      const cur = playbackCache.get(key);
      if (cur) cur.inFlightFetch = null;
      // Failure isn't cached for active playback — next subscriber retries
      // fresh so a transient network blip doesn't lock playback out for the
      // full TTL. Prefetch callers keep their own short failure backoff below.
      playbackCache.delete(key);
      logger.info("Hook:StreamPlayback", "playback URL failed", {
        traceId,
        platform,
        identifier,
        cacheSource,
        durationMs: Date.now() - fetchStartedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  })();
  return entry.inFlightFetch;
}

export function prefetchStreamPlayback(
  platform: Platform,
  identifier: string
): Promise<void> | undefined {
  if (!identifier || typeof window === "undefined" || !window.electronAPI) return undefined;

  const key = getPlaybackCacheKey(platform, identifier);
  const now = Date.now();
  const failureExpiry = playbackPrefetchFailures.get(key);
  if (failureExpiry !== undefined) {
    if (now < failureExpiry) return undefined;
    playbackPrefetchFailures.delete(key);
  }

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

  if (entry.evictionTimer) {
    clearTimeout(entry.evictionTimer);
    entry.evictionTimer = null;
  }

  if (entry.playback && now < entry.expiresAt) return Promise.resolve();
  if (entry.inFlightFetch) {
    return entry.inFlightFetch
      .then(() => undefined)
      .catch((err) => {
        playbackPrefetchFailures.set(key, Date.now() + PREFETCH_FAILURE_TTL_MS);
        logger.debug("Hook:StreamPlayback", "playback prefetch joined request failed", {
          platform,
          identifier,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  const traceId = `playback-prefetch-${++playbackRequestCounter}`;
  logger.debug("Hook:StreamPlayback", "prefetching playback URL", {
    traceId,
    platform,
    identifier,
  });

  return startPlaybackFetch(key, entry, traceId, platform, identifier, "prefetch")
    .then(() => undefined)
    .catch((err) => {
      playbackPrefetchFailures.set(key, Date.now() + PREFETCH_FAILURE_TTL_MS);
      logger.debug("Hook:StreamPlayback", "playback prefetch failed", {
        traceId,
        platform,
        identifier,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

function subscribePlayback(
  platform: Platform,
  identifier: string
): { promise: Promise<StreamPlayback>; release: () => void } {
  const key = getPlaybackCacheKey(platform, identifier);
  const traceId = `playback-${++playbackRequestCounter}`;
  const subscribedAt = Date.now();
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
  logger.debug("Hook:StreamPlayback", "subscribed to playback cache", {
    traceId,
    platform,
    identifier,
    refCount: entry.refCount,
  });

  let promise: Promise<StreamPlayback>;
  if (entry.playback && Date.now() < entry.expiresAt) {
    const cachedPlayback = entry.playback;
    logger.debug("Hook:StreamPlayback", "served playback URL from cache", {
      traceId,
      platform,
      identifier,
      ageRemainingMs: entry.expiresAt - Date.now(),
      refCount: entry.refCount,
    });
    logger.info("Hook:StreamPlayback", "playback URL ready", {
      traceId,
      platform,
      identifier,
      cacheSource: "memory",
      durationMs: 0,
      ...summarizePlaybackUrl(cachedPlayback.url),
    });
    promise = Promise.resolve(cachedPlayback);
  } else if (entry.inFlightFetch) {
    logger.debug("Hook:StreamPlayback", "joined in-flight playback request", {
      traceId,
      platform,
      identifier,
      refCount: entry.refCount,
    });
    promise = entry.inFlightFetch.then((playback) => {
      logger.info("Hook:StreamPlayback", "playback URL ready", {
        traceId,
        platform,
        identifier,
        cacheSource: "in-flight",
        durationMs: Date.now() - subscribedAt,
        ...summarizePlaybackUrl(playback.url),
      });
      return playback;
    });
  } else {
    logger.debug("Hook:StreamPlayback", "started cold playback request", {
      traceId,
      platform,
      identifier,
    });
    entry.inFlightFetch = startPlaybackFetch(key, entry, traceId, platform, identifier, "network");
    promise = entry.inFlightFetch;
  }
  const subscribedEntry = entry;

  const release = () => {
    const cur = playbackCache.get(key);
    // A shared reload replaces the cache entry. A cleanup from the previous
    // generation must never decrement or evict the fresh generation.
    if (!cur || cur !== subscribedEntry) return;
    cur.refCount--;
    logger.debug("Hook:StreamPlayback", "released playback cache subscription", {
      traceId,
      platform,
      identifier,
      refCount: cur.refCount,
      lifetimeMs: Date.now() - subscribedAt,
    });
    if (cur.refCount <= 0 && !cur.evictionTimer) {
      // timer-allowlist: TTL eviction in subscribePlayback (module-level, non-React; SP2 out-of-scope)
      cur.evictionTimer = setTimeout(() => {
        const c = playbackCache.get(key);
        if (c && c.refCount <= 0) {
          logger.debug("Hook:StreamPlayback", "evicted idle playback cache entry", {
            traceId,
            platform,
            identifier,
          });
          playbackCache.delete(key);
        }
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
  /** Monotonic revision for remounting players after a successful refresh, even if the URL is unchanged. */
  playbackRevision: number;
}

export function useStreamPlayback(platform: Platform, identifier: string): UseStreamPlaybackResult {
  const { recoveryCount } = useNetworkStatus();
  // Unique ID for this hook instance (for staggered loading)
  const instanceId = useId();
  const streamIdentity = `${platform}:${identifier}`;
  const stateIdentityRef = useRef(streamIdentity);
  const stateMatchesCurrentIdentity = stateIdentityRef.current === streamIdentity;
  const [playback, setPlayback] = useState<StreamPlayback | null>(null);
  const [isLoading, setIsLoading] = useState(!!identifier);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Track if we're using proxy to enable fallback
  const [isUsingProxy, setIsUsingProxy] = useState(false);
  // Force disable proxy for fallback
  const [forceNoProxy, setForceNoProxy] = useState(false);
  // Track reload attempts to prevent infinite loops
  // Use ref for synchronous access in callbacks, state for consumers
  const reloadAttemptsRef = useRef(0);
  const handledRecoveryCountRef = useRef(recoveryCount);
  const [reloadAttempts, setReloadAttempts] = useState(0);
  const [playbackRevision, setPlaybackRevision] = useState(0);
  const playbackCacheKey = getPlaybackCacheKey(platform, identifier);

  // biome-ignore lint/correctness/useExhaustiveDependencies: platform is part of stream identity; the same slug can exist on Twitch and Kick.
  useEffect(() => {
    // Reset all state when the platform or stream identifier changes.
    stateIdentityRef.current = streamIdentity;
    setPlayback(null);
    setIsLoading(!!identifier);
    setError(null);
    setIsUsingProxy(false);
    setForceNoProxy(false);
    reloadAttemptsRef.current = 0; // Sync ref
    setReloadAttempts(0); // Reset attempts when stream changes
    setPlaybackRevision(0);
  }, [platform, identifier, streamIdentity]);

  // Register this instance for stagger calculation only while it has a real
  // stream. Empty identifiers are used to keep hidden player surfaces idle.
  useEffect(() => {
    if (!identifier) return;
    if (!activeInstances.has(instanceId)) {
      activeInstances.set(instanceId, activeInstances.size);
    }
    return () => {
      activeInstances.delete(instanceId);
    };
  }, [identifier, instanceId]);

  useEffect(() => {
    if (!identifier) return;
    let listeners = playbackReloadListeners.get(playbackCacheKey);
    if (!listeners) {
      listeners = new Set();
      playbackReloadListeners.set(playbackCacheKey, listeners);
    }

    const handleSharedReload = () => {
      setPlayback(null);
      setError(null);
      setIsLoading(true);
      setReloadKey((previous) => previous + 1);
    };
    listeners.add(handleSharedReload);

    return () => {
      listeners.delete(handleSharedReload);
      if (listeners.size === 0) playbackReloadListeners.delete(playbackCacheKey);
    };
  }, [identifier, playbackCacheKey]);

  useEffect(() => {
    const previousRecoveryCount = handledRecoveryCountRef.current;
    if (recoveryCount <= previousRecoveryCount) return;

    if (!stateMatchesCurrentIdentity || !identifier) {
      handledRecoveryCountRef.current = recoveryCount;
      return;
    }

    // A recovery observed while the old request is still pending remains
    // available. If that request fails, the settled error render consumes the
    // same recovery and starts one clean fetch.
    if (isLoading) return;

    handledRecoveryCountRef.current = recoveryCount;
    if (playback !== null || error === null) return;

    reloadAttemptsRef.current = 0;
    setReloadAttempts(0);
    requestSharedPlaybackReload(playbackCacheKey);
  }, [
    error,
    identifier,
    isLoading,
    playback,
    playbackCacheKey,
    recoveryCount,
    stateMatchesCurrentIdentity,
  ]);

  // Ref holds the pending fetchUrl for the current effect run so the stable
  // useManagedTimeout callback can invoke whichever fetchUrl is current.
  const pendingFetchRef = useRef<(() => void) | null>(null);
  const staggerTimer = useManagedTimeout(
    useCallback(() => {
      pendingFetchRef.current?.();
    }, [])
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadKey` is the manual re-fetch trigger; the body doesn't read it
  useEffect(() => {
    if (!identifier) return;

    let isMounted = true;
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
          setPlaybackRevision((prev) => prev + 1);

          // Detect if this is a proxy URL (check for known proxy domains)
          const playbackUrl = newPlayback.url;
          const usingProxy =
            (playbackUrl.includes("cdn-perfprod.com") || playbackUrl.includes("luminous.dev")) &&
            !forceNoProxy;
          logger.debug("Hook:StreamPlayback", "loaded URL", {
            ...summarizePlaybackUrl(playbackUrl),
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
            logger.error("Hook:StreamPlayback", "failed to load stream playback", {
              platform,
              identifier,
              error:
                err instanceof Error
                  ? { name: err.name, message: err.message, stack: err.stack }
                  : String(err),
            });
          }
          setPlayback(null);
          setError(error);
          setIsLoading(false);
        }
      }
    };

    // Calculate stagger delay based on instance order.
    // This spreads out API requests when multiple streams load simultaneously.
    const instanceOrder = activeInstances.get(instanceId) ?? 0;
    const staggerDelay = instanceOrder * STAGGER_DELAY_MS;

    if (staggerDelay > 0) {
      logger.debug("Hook:StreamPlayback", "staggering fetch", {
        platform,
        identifier,
        staggerDelayMs: staggerDelay,
        instanceOrder,
      });
      pendingFetchRef.current = fetchUrl;
      staggerTimer.start(staggerDelay);
    } else {
      fetchUrl();
    }

    return () => {
      isMounted = false;
      pendingFetchRef.current = null;
      staggerTimer.clear();
      if (release) {
        release();
      }
    };
  }, [platform, identifier, forceNoProxy, instanceId, staggerTimer, reloadKey]);

  const retryWithoutProxy = useCallback(() => {
    logger.debug("Hook:StreamPlayback", "retrying without proxy (fallback to direct)");
    setForceNoProxy(true);
    requestSharedPlaybackReload(playbackCacheKey);
  }, [playbackCacheKey]);

  // Reload with rate limiting to prevent infinite loops
  // Uses a ref for synchronous tracking since React state updates are async/batched
  const reload = useCallback(() => {
    if (reloadAttemptsRef.current >= MAX_RELOAD_ATTEMPTS) {
      logger.debug("Hook:StreamPlayback", "max reload attempts reached, stopping", {
        maxReloadAttempts: MAX_RELOAD_ATTEMPTS,
      });
      setError(new Error("Max reload attempts reached - stream may be offline"));
      return;
    }
    reloadAttemptsRef.current += 1;
    setReloadAttempts(reloadAttemptsRef.current); // Keep state in sync for consumers
    requestSharedPlaybackReload(playbackCacheKey);
  }, [playbackCacheKey]);

  return {
    playback: stateMatchesCurrentIdentity ? playback : null,
    isLoading: stateMatchesCurrentIdentity ? isLoading : Boolean(identifier),
    error: stateMatchesCurrentIdentity ? error : null,
    isUsingProxy: stateMatchesCurrentIdentity ? isUsingProxy : false,
    reload,
    retryWithoutProxy,
    reloadAttempts: stateMatchesCurrentIdentity ? reloadAttempts : 0,
    playbackRevision: stateMatchesCurrentIdentity ? playbackRevision : 0,
  };
}
