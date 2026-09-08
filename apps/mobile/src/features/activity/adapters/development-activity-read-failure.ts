import type {
  ActivityFilter,
  ActivityRepository,
} from "@mobile/features/storage/capabilities/persistence";

export interface DevelopmentActivityReadFailureProof {
  deactivate(): void;
  drain(): Promise<void>;
  queueNextListFailure(): { readonly kind: "queued" };
  readonly repository: ActivityRepository;
}

export function createDevelopmentActivityReadFailureProof(
  repository: ActivityRepository,
): DevelopmentActivityReadFailureProof {
  let active = true;
  let listFailureQueued = false;
  let pending = 0;
  const drainListeners = new Set<() => void>();
  const requireActive = () => {
    if (!active) throw new Error("The isolated Activity proof is closing.");
  };
  const track = <Value>(operation: Promise<Value>) => {
    pending += 1;
    return operation.finally(() => {
      pending -= 1;
      if (pending === 0) {
        for (const listener of drainListeners) listener();
        drainListeners.clear();
      }
    });
  };

  return {
    deactivate() {
      active = false;
    },
    drain() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => drainListeners.add(resolve));
    },
    queueNextListFailure() {
      listFailureQueued = true;
      return { kind: "queued" };
    },
    repository: {
      dismissCompleted: (eventIds, dismissedAt) => {
        requireActive();
        return track(repository.dismissCompleted(eventIds, dismissedAt));
      },
      list: async (filter?: ActivityFilter) => {
        requireActive();
        if (listFailureQueued) {
          listFailureQueued = false;
          throw new Error("Development Activity list failure.");
        }
        return track(repository.list(filter));
      },
      markAllRead: (readAt) => {
        requireActive();
        return track(repository.markAllRead(readAt));
      },
      markRead: (eventId, readAt) => {
        requireActive();
        return track(repository.markRead(eventId, readAt));
      },
      record: (item) => {
        requireActive();
        return track(repository.record(item));
      },
    },
  };
}
