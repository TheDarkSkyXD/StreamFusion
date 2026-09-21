import type { PlaybackFiltering } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { PlaybackSessionPolicy } from "@mobile/features/settings/capabilities/settings";
import type { RuntimeDegradationStage } from "@mobile/features/capability-profile/domain/capability-profile";
import type {
  FocusedPlaybackPort,
  LivePlaybackSources,
  NativePlaybackEvent,
  PlaybackCompatibilityPolicy,
  WatchTarget,
} from "@mobile/features/watch/capabilities/watch";
import { runFocusedWatchStart } from "@mobile/features/watch/domain/start-focused-watch";
import {
  emptyMultistreamLayout,
  multistreamSessionId,
  type ActiveVideoAdmission,
  type MultistreamLayout,
  type QualifiedMultistream,
} from "../capabilities/multistream";
import { qualifyMultistream } from "./multistream-admission";
import { watchTargetFromSlot } from "./multistream-layout";

export type SlotPlaybackPhase = "idle" | "buffering" | "playing" | "paused" | "failed";

export interface MultistreamPlaybackSnapshot {
  readonly phases: Readonly<Record<string, SlotPlaybackPhase>>;
  readonly qualified: QualifiedMultistream;
}

export interface MultistreamPlayback {
  dispose(): Promise<void>;
  enterPictureInPicture(): Promise<void>;
  snapshot(): MultistreamPlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  sync(input: {
    readonly admission: ActiveVideoAdmission;
    readonly layout: MultistreamLayout;
    readonly stage: RuntimeDegradationStage;
  }): Promise<QualifiedMultistream>;
}

const NO_PROTECTION = {
  acquire: () => ({ release() {} }),
  snapshot: () => ({ kind: "normal" as const }),
  subscribe: () => () => undefined,
};

/** Cached for useSyncExternalStore — a fresh object each call loops Multistream. */
export const IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT: MultistreamPlaybackSnapshot = {
  phases: {},
  qualified: {
    activeSlotIds: [],
    admission: { limit: 1, reason: "No Multistream measurement yet." },
    layout: emptyMultistreamLayout(0),
    notice: null,
    pausedSlotIds: [],
    thumbnailSlotIds: [],
  },
};

export function createMultistreamPlayback(input: {
  readonly filtering?: PlaybackFiltering;
  readonly playback: FocusedPlaybackPort;
  readonly playbackSettings?: { snapshot(): PlaybackSessionPolicy };
  readonly policy: PlaybackCompatibilityPolicy;
  readonly sources: LivePlaybackSources;
}): MultistreamPlayback {
  const listeners = new Set<() => void>();
  const running = new Map<
    string,
    { readonly lease: { release(): void }; readonly target: WatchTarget }
  >();
  let generation = 0;
  let phases: Record<string, SlotPlaybackPhase> = {};
  let qualified: QualifiedMultistream | null = null;
  let cachedSnapshot: MultistreamPlaybackSnapshot =
    IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT;
  const refreshSnapshotCache = () => {
    if (qualified === null && Object.keys(phases).length === 0) {
      cachedSnapshot = IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT;
      return;
    }
    cachedSnapshot = {
      phases,
      qualified: qualified ?? IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT.qualified,
    };
  };
  const notify = () => {
    refreshSnapshotCache();
    listeners.forEach((listener) => listener());
  };
  const unsubscribe = input.playback.subscribe((event) => {
    applyEvent(event);
  });

  function applyEvent(event: NativePlaybackEvent): void {
    const slotId = slotIdFromSession(event.sessionId);
    if (!slotId || !running.has(slotId)) return;
    const phase = phaseFromEvent(event.kind);
    if (!phase) return;
    phases = { ...phases, [slotId]: phase };
    notify();
  }

  async function stop(slotId: string): Promise<void> {
    const current = running.get(slotId);
    running.delete(slotId);
    delete phases[slotId];
    current?.lease.release();
    await input.playback.end(multistreamSessionId(slotId));
  }

  async function start(slotId: string, target: WatchTarget, attempt: number): Promise<void> {
    phases = { ...phases, [slotId]: "buffering" };
    const outcome = await runFocusedWatchStart({
      attempt,
      ...(input.filtering === undefined ? {} : { filtering: input.filtering }),
      generation: () => generation,
      playback: input.playback,
      ...(input.playbackSettings === undefined
        ? {}
        : { playbackSettings: input.playbackSettings }),
      policy: input.policy,
      protection: NO_PROTECTION,
      sessionIds: { create: () => multistreamSessionId(slotId) },
      sources: input.sources,
      target,
    });
    if (attempt !== generation) {
      if (outcome.kind === "started") {
        outcome.lease.release();
        await input.playback.end(outcome.session.sessionId);
      }
      return;
    }
    if (outcome.kind !== "started") {
      phases = { ...phases, [slotId]: "failed" };
      return;
    }
    running.set(slotId, { lease: outcome.lease, target });
    phases = { ...phases, [slotId]: "playing" };
  }

  async function applyActiveControls(
    projected: QualifiedMultistream,
    stage: RuntimeDegradationStage,
  ): Promise<void> {
    await Promise.all(
      projected.activeSlotIds.map(async (id) => {
        if (!running.has(id)) return;
        const sessionId = multistreamSessionId(id);
        await input.playback.setMuted(
          sessionId,
          projected.layout.audioOwnerId !== id,
        );
        const pauseNonfocused =
          stage >= 4 && projected.layout.focusedSlotId !== id;
        const lowerQuality =
          stage >= 2 && projected.layout.focusedSlotId !== id;
        await input.playback.setPlaying(sessionId, !pauseNonfocused);
        const prefs = input.playbackSettings?.snapshot();
        const focusedQuality = prefs?.quality ?? "auto";
        const backgroundQuality = prefs?.backgroundQuality ?? "360p";
        await input.playback.setQuality(
          sessionId,
          lowerQuality ? backgroundQuality : focusedQuality,
        );
      }),
    );
  }

  return {
    async dispose() {
      generation += 1;
      unsubscribe();
      const held = [...running.values()];
      const ids = [...running.keys()];
      running.clear();
      phases = {};
      qualified = null;
      cachedSnapshot = IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT;
      held.forEach((item) => item.lease.release());
      await Promise.all(ids.map((id) => input.playback.end(multistreamSessionId(id))));
    },
    async enterPictureInPicture() {
      const owner = qualified?.layout.audioOwnerId ?? qualified?.layout.focusedSlotId;
      if (!owner || !running.has(owner)) return;
      await input.playback.enterPictureInPicture(multistreamSessionId(owner));
    },
    snapshot() {
      return cachedSnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async sync(next) {
      const attempt = ++generation;
      const projected = qualifyMultistream(next);
      qualified = projected;
      const wanted = new Set(projected.activeSlotIds);
      const stopping = [...running.keys()].filter((id) => !wanted.has(id));
      await Promise.all(stopping.map((id) => stop(id)));
      if (attempt !== generation) return projected;
      const starts = projected.activeSlotIds.flatMap((id) => {
        const slot = projected.layout.slots.find((item) => item.id === id);
        if (!slot || running.has(id)) return [];
        return [start(id, watchTargetFromSlot(slot), attempt)];
      });
      await Promise.all(starts);
      if (attempt !== generation) return projected;
      await applyActiveControls(projected, next.stage);
      notify();
      return projected;
    },
  };
}

function phaseFromEvent(kind: NativePlaybackEvent["kind"]): SlotPlaybackPhase | null {
  switch (kind) {
    case "failed":
      return "failed";
    case "buffering":
      return "buffering";
    case "playing":
      return "playing";
    case "paused":
    case "ended":
      return "paused";
    default:
      return null;
  }
}

function slotIdFromSession(sessionId: string): string | null {
  return sessionId.startsWith("multi:") ? sessionId.slice("multi:".length) : null;
}
