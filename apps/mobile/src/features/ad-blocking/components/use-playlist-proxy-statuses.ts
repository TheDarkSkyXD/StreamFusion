import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PlaylistProxyHealth,
  PlaylistProxySourceStatus,
} from "../capabilities/playlist-proxy-health";
import type { TwitchPlaylistProxySource } from "../capabilities/twitch-playlist-proxy";

const PROBE_TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_PROBES = 10;

export function usePlaylistProxyStatuses(
  sources: readonly TwitchPlaylistProxySource[],
  health: PlaylistProxyHealth,
) {
  const [statuses, setStatuses] = useState<
    Record<string, PlaylistProxySourceStatus>
  >({});
  const controllers = useRef<AbortController[]>([]);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    for (const controller of controllers.current) controller.abort();
    controllers.current = [];
    const current = ++generation.current;
    setStatuses(
      Object.fromEntries(sources.map((source) => [source.id, "checking"])),
    );
    let nextIndex = 0;
    const probe = async () => {
      while (nextIndex < sources.length && current === generation.current) {
        const source = sources[nextIndex++];
        if (!source) return;
        const controller = new AbortController();
        controllers.current.push(controller);
        const status = await probeStatus(health, source, controller);
        if (current !== generation.current) return;
        setStatuses((previous) => ({ ...previous, [source.id]: status }));
      }
    };
    void Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_PROBES, sources.length) },
        probe,
      ),
    );
  }, [health, sources]);

  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      for (const controller of controllers.current) controller.abort();
    };
  }, [refresh]);

  return { statuses, refresh };
}

async function probeStatus(
  health: PlaylistProxyHealth,
  source: TwitchPlaylistProxySource,
  controller: AbortController,
): Promise<"online" | "offline"> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<"offline">((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve("offline");
    }, PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      health.check(source, controller.signal).catch((): "offline" => "offline"),
      timedOut,
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
