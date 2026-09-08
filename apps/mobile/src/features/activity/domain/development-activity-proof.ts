import {
  toSerializedTimestamp,
  type ActivityItem,
} from "@streamfusion/core/activity";
import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import type {
  DevelopmentActivityProof,
  DevelopmentActivityProofMainBaseline,
  DevelopmentActivityProofSession,
  DevelopmentActivityProofSessionPort,
  DevelopmentActivityProofStore,
  DevelopmentActivityProofStoreFactory,
  DevelopmentActivityProofViewModel,
  DevelopmentActivityReadFailurePort,
} from "../capabilities/development-activity-proof";

const namespacePrefix = "activity-proof-";
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const compactUuidPattern = /^[a-f0-9]{32}$/u;

function createNamespace(uuid: string): string {
  const normalized = uuid.toLowerCase();
  const canonical = compactUuidPattern.test(normalized)
    ? `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`
    : normalized;
  if (!uuidPattern.test(canonical))
    throw new Error("The Activity proof identifier is invalid.");
  return `${namespacePrefix}${canonical}`;
}

function proofItems(
  now: number,
  completedOnly: boolean,
): readonly ActivityItem[] {
  const occurredAt = toSerializedTimestamp(new Date(now).toISOString());
  const completed: readonly ActivityItem[] = [
    {
      body: "Development-only completed channel fixture.",
      channel: {
        displayName: "Proof Channel",
        id: "proof-channel",
        login: "proofchannel",
        platform: "twitch",
      },
      destination: {
        channelId: "proof-channel",
        channelLogin: "proofchannel",
        kind: "watch-channel",
        platform: "twitch",
      },
      event: "live-alert",
      eventId: "proof:activity:channel-completed:v1",
      kind: "channel",
      occurredAt,
      readAt: null,
      schemaVersion: 1,
      source: "local",
      title: "Proof Channel completed",
    },
    {
      body: "Development-only completed system fixture.",
      destination: { kind: "diagnostics" },
      event: "device-health",
      eventId: "proof:activity:system-completed:v1",
      kind: "system",
      occurredAt,
      readAt: null,
      schemaVersion: 1,
      source: "local",
      title: "Proof storage check completed",
    },
    {
      body: "Development-only terminal job fixture.",
      destination: { jobId: "proof-job-terminal", kind: "media-job" },
      eventId: "proof:activity:job-terminal:v1",
      job: { id: "proof-job-terminal", state: { kind: "terminal" } },
      kind: "job",
      occurredAt,
      readAt: null,
      schemaVersion: 1,
      source: "local",
      title: "Proof download completed",
    },
  ];
  if (completedOnly) return completed;
  return [
    ...completed,
    {
      body: "Development-only active job fixture.",
      destination: { jobId: "proof-job-active", kind: "media-job" },
      eventId: "proof:activity:job-active:v1",
      job: { id: "proof-job-active", state: { kind: "active" } },
      kind: "job",
      occurredAt,
      readAt: null,
      schemaVersion: 1,
      source: "local",
      title: "Proof recording remains active",
    },
  ];
}

function fingerprint(
  items: readonly ActivityItem[],
): DevelopmentActivityProofMainBaseline {
  const serialized = [...items]
    .map((item) => `${item.eventId}\u0000${item.readAt ?? ""}`)
    .sort()
    .join("\u0001");
  let hash = 2_166_136_261;
  for (const character of serialized)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return {
    count: items.length,
    digest: (hash >>> 0).toString(16).padStart(8, "0"),
  };
}

function sameBaseline(
  left: DevelopmentActivityProofMainBaseline,
  right: DevelopmentActivityProofMainBaseline,
) {
  return left.count === right.count && left.digest === right.digest;
}

type Selection = Readonly<{
  readFailure: DevelopmentActivityReadFailurePort;
  session: DevelopmentActivityProofSession;
  store: DevelopmentActivityProofStore;
}>;

export function createDevelopmentActivityProof(options: {
  readonly createReadFailure: (
    repository: ActivityRepository,
  ) => DevelopmentActivityReadFailurePort;
  readonly mainRepository: ActivityRepository;
  readonly now: () => number;
  readonly randomUuid: () => string;
  readonly session: DevelopmentActivityProofSessionPort;
  readonly stores: DevelopmentActivityProofStoreFactory;
}): DevelopmentActivityProof {
  let selection: Selection | null = null;
  let model: DevelopmentActivityProofViewModel = {
    detail: "Main Activity is selected.",
    kind: "main",
  };
  let operation = Promise.resolve();
  const listeners = new Set<
    (model: DevelopmentActivityProofViewModel) => void
  >();
  const publish = (next: DevelopmentActivityProofViewModel) => {
    model = next;
    for (const listener of listeners) listener(next);
  };
  const run = (work: () => Promise<void>) => {
    const next = operation.then(work, work);
    operation = next.catch(() => undefined);
    return next;
  };
  const seed = async (
    repository: ActivityRepository,
    completedOnly: boolean,
  ) => {
    for (const item of proofItems(options.now(), completedOnly))
      await repository.record(item);
  };
  const readMainBaseline = async () =>
    fingerprint(await options.mainRepository.list());
  const publishCleanupRequired = (
    session: DevelopmentActivityProofSession,
    detail: string,
    selected = selection !== null,
  ) =>
    publish({
      detail,
      kind: "cleanup-required",
      namespace: session.namespace,
      selected,
    });
  const reportReadFailure = () => {
    if (model.kind === "cleanup-required") {
      publish({
        ...model,
        detail:
          "The proof session marker could not be read. Retry exact cleanup when SecureStore recovers.",
      });
    } else if (selection) {
      publish({
        detail:
          "The proof session marker could not be read. The selected isolated Activity remains available; retry Exit when SecureStore recovers.",
        kind: "proof",
        namespace: selection.session.namespace,
      });
    } else {
      publish({
        detail:
          "The Activity proof session could not be read. Retry Start when SecureStore recovers.",
        kind: "unavailable",
      });
    }
  };
  const readSession = async () => {
    try {
      return await options.session.read();
    } catch {
      return { kind: "read-failed" } as const;
    }
  };
  const select = (
    store: DevelopmentActivityProofStore,
    session: DevelopmentActivityProofSession,
    detail: string,
  ) => {
    selection = {
      readFailure: options.createReadFailure(store.activity),
      session,
      store,
    };
    publish({ detail, kind: "proof", namespace: session.namespace });
  };
  const openActive = async (
    session: DevelopmentActivityProofSession,
    seedFixtures: boolean,
  ) => {
    let store: DevelopmentActivityProofStore | null = null;
    try {
      store = options.stores.open(session.namespace);
      if ((await store.initialize()).kind !== "ready")
        throw new Error("Proof store initialization failed.");
      if (seedFixtures) await seed(store.activity, false);
      select(
        store,
        session,
        seedFixtures
          ? "Isolated Activity proof data is selected. Exit cleans only this proof namespace."
          : "Recovered isolated Activity proof data is selected without replaying fixtures.",
      );
    } catch {
      if (store)
        selection = {
          readFailure: options.createReadFailure(store.activity),
          session,
          store,
        };
      publish({
        detail:
          "The isolated Activity proof could not become active. Exit can retry exact cleanup.",
        kind: "cleanup-required",
        namespace: session.namespace,
        selected: store !== null,
      });
    }
  };
  const cleanup = async (session: DevelopmentActivityProofSession) => {
    if (selection && selection.session.namespace !== session.namespace) return;
    try {
      await options.session.write({ ...session, phase: "cleanup" });
    } catch {
      if (model.kind === "cleanup-required") {
        publish({
          ...model,
          detail:
            "Proof cleanup could not save its cleanup intent. Retry Exit to clean the exact saved proof namespace.",
        });
      } else if (selection) {
        publish({
          detail:
            "Proof cleanup could not save its cleanup intent. The isolated Activity remains selected; retry Exit.",
          kind: "proof",
          namespace: session.namespace,
        });
      } else {
        publishCleanupRequired(
          session,
          "Proof cleanup could not save its cleanup intent. Main Activity remains selected; retry cleanup.",
          false,
        );
      }
      return;
    }
    let store = selection?.store;
    if (!store) {
      try {
        store = options.stores.open(session.namespace);
      } catch {
        publish({
          detail:
            "Proof cleanup could not open its exact saved namespace. Retry Exit.",
          kind: "cleanup-required",
          namespace: session.namespace,
          selected: false,
        });
        return;
      }
    }
    selection?.readFailure.deactivate();
    publish({
      detail:
        "Isolated Activity cleanup is in progress. Activity actions are unavailable until Exit finishes.",
      kind: "cleanup-required",
      namespace: session.namespace,
      selected: selection !== null,
    });
    try {
      await selection?.readFailure.drain();
      await store.close();
      await store.cleanup();
      const preserved = sameBaseline(
        session.mainActivity,
        await readMainBaseline(),
      );
      await options.session.clear();
      selection = null;
      publish({
        detail: preserved
          ? "Main Activity is selected. Its ID and read-state baseline was preserved during this proof."
          : "Main Activity is selected. Its ID or read-state baseline changed during this proof, so preservation was not verified.",
        kind: "main",
      });
    } catch {
      const readFailure =
        selection?.readFailure ?? options.createReadFailure(store.activity);
      readFailure.deactivate();
      selection = {
        readFailure,
        session: { ...session, phase: "cleanup" },
        store,
      };
      publish({
        detail:
          "Proof cleanup could not finish. Retry Exit to clean the exact saved proof namespace.",
        kind: "cleanup-required",
        namespace: session.namespace,
        selected: true,
      });
    }
  };

  return {
    exit: () =>
      run(async () => {
        const result = await readSession();
        if (result.kind === "read-failed") return reportReadFailure();
        if (result.kind === "invalid") {
          if (selection) {
            return publishCleanupRequired(
              selection.session,
              "The Activity proof marker is invalid. The selected isolated Activity remains available; retry Exit after repairing SecureStore.",
              true,
            );
          }
          return publish({
            detail:
              "The Activity proof marker is invalid and cannot be cleaned automatically.",
            kind: "unavailable",
          });
        }
        if (result.kind === "session") await cleanup(result.session);
      }),
    recover: () =>
      run(async () => {
        if (selection) return;
        const result = await readSession();
        if (result.kind === "read-failed") return reportReadFailure();
        if (result.kind === "invalid")
          return publish({
            detail:
              "The Activity proof session marker is invalid. Main Activity remains selected.",
            kind: "unavailable",
          });
        if (result.kind !== "session") return;
        if (result.session.phase === "active")
          await openActive(result.session, false);
        else
          publish({
            detail:
              "An interrupted isolated Activity proof requires exact cleanup before another proof can start. Main Activity remains selected.",
            kind: "cleanup-required",
            namespace: result.session.namespace,
            selected: false,
          });
      }),
    replayCompleted: () =>
      run(async () => {
        if (!selection || model.kind !== "proof") return;
        try {
          await seed(selection.store.activity, true);
          publish({
            detail:
              "Replayed stable completed proof Activity IDs without resetting local read or dismissal state.",
            kind: "proof",
            namespace: selection.session.namespace,
          });
        } catch {
          publish({
            detail:
              "Proof Activity replay could not be saved. The existing proof session remains selected; Exit remains available.",
            kind: "proof",
            namespace: selection.session.namespace,
          });
        }
      }),
    get repository() {
      return selection?.readFailure.repository ?? options.mainRepository;
    },
    retryCleanup: () =>
      run(async () => {
        const result = await readSession();
        if (result.kind === "read-failed") return reportReadFailure();
        if (result.kind === "invalid") {
          if (selection) {
            return publishCleanupRequired(
              selection.session,
              "The Activity proof marker is invalid. Retry cleanup after repairing SecureStore.",
              true,
            );
          }
          return publish({
            detail:
              "The Activity proof marker is invalid and cannot be cleaned automatically.",
            kind: "unavailable",
          });
        }
        if (result.kind === "session") await cleanup(result.session);
      }),
    start: () =>
      run(async () => {
        if (selection) return;
        const result = await readSession();
        if (result.kind === "read-failed") return reportReadFailure();
        if (result.kind === "invalid")
          return publish({
            detail:
              "The Activity proof session marker is invalid. It was not replaced.",
            kind: "unavailable",
          });
        if (result.kind === "session") {
          if (result.session.phase === "active")
            await openActive(result.session, false);
          else
            publish({
              detail:
                "An interrupted isolated Activity proof requires exact cleanup before another proof can start. Main Activity remains selected.",
              kind: "cleanup-required",
              namespace: result.session.namespace,
              selected: false,
            });
          return;
        }
        let session: DevelopmentActivityProofSession;
        try {
          session = {
            mainActivity: await readMainBaseline(),
            namespace: createNamespace(options.randomUuid()),
            phase: "initializing",
            version: 1,
          };
          await options.session.write(session);
        } catch {
          publish({
            detail:
              "The Activity proof session could not be saved. Main Activity remains selected.",
            kind: "unavailable",
          });
          return;
        }
        await openActive(session, true);
        if (model.kind !== "proof") return;
        try {
          await options.session.write({ ...session, phase: "active" });
        } catch {
          publish({
            detail:
              "The isolated Activity proof is selected, but its active marker could not be saved. Exit remains available for cleanup.",
            kind: "proof",
            namespace: session.namespace,
          });
        }
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    queueNextReadFailure() {
      selection?.readFailure.queueNextListFailure();
    },
    snapshot: () => model,
  };
}
