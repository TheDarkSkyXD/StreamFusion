import { useCallback, useEffect, useRef, useState } from "react";

import {
  isTwitchPlaylistProxyOnlineResponse,
  isTwitchPlaylistProxyTemplate,
  resolveTwitchPlaylistProxyPingUrl,
} from "@/features/playback/utils/twitch-playlist-proxy";
import type { TwitchPlaylistProxySource } from "@shared/auth-types";

export type TwitchPlaylistProxyStatus = "checking" | "online" | "offline";

const MAX_CONCURRENT_PROBES = 10;
const PROBE_TIMEOUT_MS = 5_000;

export function useTwitchPlaylistProxyStatuses(sources: readonly TwitchPlaylistProxySource[]) {
  const [statuses, setStatuses] = useState<Record<string, TwitchPlaylistProxyStatus>>({});
  const probeGenerationRef = useRef(0);
  const activeProbeControllersRef = useRef<AbortController[]>([]);

  const abortActiveProbes = useCallback(() => {
    probeGenerationRef.current += 1;
    for (const controller of activeProbeControllersRef.current) controller.abort();
    activeProbeControllersRef.current = [];
  }, []);

  const refresh = useCallback(() => {
    abortActiveProbes();
    const generation = probeGenerationRef.current;
    const invalidStatuses = Object.fromEntries(
      sources.map((source) => [source.id, "offline" as const])
    );
    const probeable = sources.flatMap((source) => {
      const pingUrl = isTwitchPlaylistProxyTemplate(source.url)
        ? resolveTwitchPlaylistProxyPingUrl(source)
        : null;
      return pingUrl ? [{ id: source.id, pingUrl }] : [];
    });
    setStatuses({
      ...invalidStatuses,
      ...Object.fromEntries(probeable.map(({ id }) => [id, "checking" as const])),
    });

    const controllers = probeable.map(() => new AbortController());
    activeProbeControllersRef.current = controllers;
    const results: Array<readonly [string, TwitchPlaylistProxyStatus]> = [];
    let nextIndex = 0;
    const probeOne = async () => {
      while (nextIndex < probeable.length) {
        const index = nextIndex;
        nextIndex += 1;
        const { id, pingUrl } = probeable[index];
        const controller = controllers[index];
        try {
          const signal = AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(PROBE_TIMEOUT_MS),
          ]);
          const response = await fetch(pingUrl, { signal });
          if (!response.ok) {
            results[index] = [id, "offline"];
            continue;
          }
          const body: unknown = await response.json();
          results[index] = [id, isTwitchPlaylistProxyOnlineResponse(body) ? "online" : "offline"];
        } catch {
          results[index] = [id, "offline"];
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_PROBES, probeable.length) }, () => probeOne())
    ).then(() => {
      if (probeGenerationRef.current !== generation) return;
      setStatuses({ ...invalidStatuses, ...Object.fromEntries(results) });
      activeProbeControllersRef.current = [];
    });
  }, [abortActiveProbes, sources]);

  useEffect(() => {
    refresh();
    return abortActiveProbes;
  }, [abortActiveProbes, refresh]);

  return { statuses, refresh };
}
