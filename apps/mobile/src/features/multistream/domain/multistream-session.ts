import type {
  FocusedPlaybackPort,
  PlaybackCompatibilityPolicy,
  WatchRuntime,
  WatchSessionIdSource,
} from "@mobile/features/watch/capabilities/watch";
import type {
  MultistreamChannelReader,
  MultistreamSession,
  MultistreamSnapshot,
  MultistreamTile,
} from "../capabilities/multistream";
import type {
  MultistreamResourceAdmission,
  MultistreamResourceMonitor,
  MultistreamResourcePressure,
} from "../capabilities/resource-admission";

export function createMultistreamSession(input: {
  readonly channels: MultistreamChannelReader;
  readonly playback: FocusedPlaybackPort;
  readonly policy: PlaybackCompatibilityPolicy;
  readonly resolve: WatchRuntime["resolveSource"];
  readonly sessionIds: WatchSessionIdSource;
  readonly limit: () => number;
  readonly beforeStart: () => Promise<void>;
  readonly admission?: MultistreamResourceAdmission;
  readonly resourceMonitor?: MultistreamResourceMonitor;
}): MultistreamSession {
  const listeners = new Set<() => void>();
  let tiles: readonly MultistreamTile[] = [];
  let audioOwner: string | null = null;
  let busy = false;
  let status: string | null = null;
  let resourcePressure: MultistreamResourcePressure = { kind: "clear" };
  let releaseResourceMonitor: (() => void) | null = null;
  let epoch = 0;
  let disposed = false;
  let pending: AbortController | null = null;
  let queue = Promise.resolve();
  const limit = () => Math.min(4, Math.max(1, Math.floor(input.limit())));
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const publish = (detail: string | null) => {
    status = detail;
    emit();
  };
  const update = (id: string, values: Partial<MultistreamTile>) => {
    tiles = tiles.map((tile) =>
      tile.id === id ? { ...tile, ...values } : tile,
    );
    emit();
  };
  const run = (operation: () => Promise<void>) => {
    if (disposed) return Promise.resolve();
    const result = queue.then(async () => {
      if (disposed) return;
      busy = true;
      emit();
      try {
        await operation();
      } catch {
        publish("The player could not complete the action. Try again.");
      } finally {
        busy = false;
        emit();
      }
    });
    queue = result;
    return result;
  };
  const monitorResources = () => {
    if (releaseResourceMonitor || !input.resourceMonitor) return;
    releaseResourceMonitor = input.resourceMonitor.subscribe(() => recheckResources());
  };
  const stopMonitoringResources = () => {
    releaseResourceMonitor?.();
    releaseResourceMonitor = null;
  };
  const recheckResources = () => {
    const generation = epoch;
    return run(async () => {
      if (generation !== epoch || tiles.length === 0 || !input.admission) return;
      const next = await input.admission.read();
      if (generation !== epoch || disposed || tiles.length === 0) return;
      resourcePressure = next;
      emit();
    });
  };
  const muteAll = async () => {
    const previousOwner = audioOwner;
    const uncertain = new Set<string>();
    for (const tile of tiles) {
      const result = await input.playback.setMuted(tile.id, true);
      if (result.kind !== "applied") {
        const ended = await input.playback.end(tile.id);
        if (ended.kind === "unavailable") uncertain.add(tile.id);
        update(tile.id, {
          state: "failed",
          detail:
            ended.kind === "unavailable"
              ? "The player could not confirm mute or stop. Retry mute before enabling another stream's audio."
              : "Audio control failed. Player stopped.",
        });
      }
    }
    audioOwner =
      previousOwner && uncertain.has(previousOwner) ? previousOwner : null;
    if (uncertain.size > 0)
      publish(
        "Audio switching paused because a player could not confirm mute or stop.",
      );
    else emit();
    return uncertain.size === 0;
  };
  const unsubscribe = input.playback.subscribe((event) => {
    if (event.kind === "failed") {
      update(event.sessionId, { state: "failed", detail: event.detail });
      if (audioOwner === event.sessionId) {
        audioOwner = null;
        emit();
      }
    } else if (
      event.kind === "playing" ||
      event.kind === "buffering" ||
      event.kind === "paused"
    ) {
      update(event.sessionId, { state: event.kind });
    } else if (event.kind === "ended") {
      update(event.sessionId, {
        state: "failed",
        detail: "This stream ended.",
      });
      if (audioOwner === event.sessionId) {
        audioOwner = null;
        emit();
      }
    }
  });
  const close = async () => {
    epoch += 1;
    pending?.abort();
    stopMonitoringResources();
    await run(async () => {
      await muteAll();
      const remaining: MultistreamTile[] = [];
      for (const tile of tiles) {
        const ended = await input.playback.end(tile.id);
        if (ended.kind === "unavailable")
          remaining.push({
            ...tile,
            state: "failed",
            detail: ended.failure.detail,
          });
      }
      tiles = remaining;
      resourcePressure = { kind: "clear" };
      if (!remaining.some((tile) => tile.id === audioOwner)) audioOwner = null;
      publish(
        remaining.length > 0
          ? "Some players could not confirm stop. Retry removing them or restart the Android client."
          : null,
      );
    });
  };
  return {
    snapshot(): MultistreamSnapshot {
      return { tiles, audioOwner, busy, limit: limit(), status, resourcePressure };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add(platform, rawLogin) {
      const generation = epoch;
      return run(async () => {
        const login = rawLogin.trim().replace(/^@/u, "").toLowerCase();
        if (!/^[a-z0-9_-]{1,64}$/u.test(login))
          return publish("Enter a channel username.");
        if (tiles.length >= limit())
          return publish(`This workspace is limited to ${limit()} streams.`);
        if (
          tiles.some(
            (tile) =>
              tile.target.platform === platform &&
              tile.target.channelName.toLowerCase() === login,
          )
        )
          return publish("That channel is already in the workspace.");
        const controller = new AbortController();
        pending = controller;
        const active = () =>
          generation === epoch && !controller.signal.aborted && !disposed;
        const admission = await input.admission?.read();
        if (!active()) return;
        if (admission) {
          resourcePressure = admission;
          if (admission.kind === "pressured") return publish(admission.detail);
        }
        const policy = await input.policy.read(platform);
        if (!active()) return;
        if (policy.kind !== "enabled")
          return publish(
            "Playback compatibility is disabled. Refresh the capability policy in Diagnostics.",
          );
        const target = await input.channels.find(
          platform,
          login,
          controller.signal,
        );
        if (!active()) return;
        if (!target)
          return publish("This channel is offline or could not be verified.");
        const source = await input.resolve(target, controller.signal);
        if (!active()) return;
        if (source.kind !== "resolved")
          return publish(
            source.failure.kind === "cancelled" ? null : source.failure.detail,
          );
        if (tiles.length === 0) await input.beforeStart();
        if (!active()) return;
        const id = input.sessionIds.create();
        const started = await input.playback.start({
          sessionId: id,
          sourceUri: source.sourceUri,
          requestHeaders: source.requestHeaders,
          muted: true,
        });
        if (!active()) {
          if (started.kind === "started") await input.playback.end(id);
          return;
        }
        pending = null;
        if (started.kind !== "started") return publish(started.failure.detail);
        tiles = [...tiles, { id, target, state: "buffering", detail: null }];
        monitorResources();
        publish("Stream added muted. Choose Listen for its audio.");
      });
    },
    focus(id) {
      return run(async () => {
        if (!tiles.some((tile) => tile.id === id && tile.state !== "failed"))
          return;
        if (!(await muteAll())) return;
        if (!tiles.some((tile) => tile.id === id && tile.state !== "failed"))
          return;
        const result = await input.playback.setMuted(id, false);
        if (result.kind === "applied") {
          audioOwner = id;
          publish(null);
        } else publish("The player could not enable audio.");
      });
    },
    mute() {
      return run(async () => {
        await muteAll();
      });
    },
    remove(id) {
      return run(async () => {
        const result = await input.playback.end(id);
        if (result.kind === "unavailable")
          return publish(result.failure.detail);
        tiles = tiles.filter((tile) => tile.id !== id);
        if (audioOwner === id) audioOwner = null;
        if (tiles.length === 0) {
          stopMonitoringResources();
          resourcePressure = { kind: "clear" };
        }
        publish(null);
      });
    },
    move(id, direction) {
      const index = tiles.findIndex((tile) => tile.id === id);
      const destination = index + (direction === "earlier" ? -1 : 1);
      if (index < 0 || destination < 0 || destination >= tiles.length) return;
      const reordered = [...tiles];
      const [tile] = reordered.splice(index, 1);
      if (!tile) return;
      reordered.splice(destination, 0, tile);
      tiles = reordered;
      emit();
    },
    pause(id, paused) {
      return run(async () => {
        const result = await input.playback.setPlaying(id, !paused);
        if (result.kind === "applied")
          update(id, { state: paused ? "paused" : "buffering" });
        else publish("The player could not change playback.");
      });
    },
    recheckResources,
    reduceToOne() {
      const generation = epoch;
      return run(async () => {
        if (generation !== epoch) return;
        const keep = tiles.some((tile) => tile.id === audioOwner)
          ? audioOwner
          : tiles[0]?.id;
        if (!keep || tiles.length < 2) return;
        const failed = new Set<string>();
        for (const tile of tiles) {
          if (tile.id === keep) continue;
          const result = await input.playback.end(tile.id);
          if (generation !== epoch) return;
          if (result.kind === "unavailable") failed.add(tile.id);
        }
        tiles = tiles
          .filter((tile) => tile.id === keep || failed.has(tile.id))
          .map((tile) =>
            failed.has(tile.id)
              ? {
                  ...tile,
                  state: "failed" as const,
                  detail: "Stop could not be confirmed. Retry removing this player or restart the Android client.",
                }
              : tile,
          );
        publish(
          failed.size > 0
            ? "Some players could not confirm stop. Retry removing them or restart the Android client."
            : "Workspace reduced to one stream.",
        );
      });
    },
    close,
    async dispose() {
      await close();
      disposed = true;
      input.resourceMonitor?.dispose();
      unsubscribe();
      listeners.clear();
    },
  };
}
