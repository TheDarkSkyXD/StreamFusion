import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ProviderCredential,
  ProviderResult,
} from "@mobile/features/moderation/capabilities/moderation";
import type { WorkflowActivity } from "@mobile/features/moderation/domain/moderation-controller";
import type {
  ChannelPoll,
  ChannelPrediction,
  EngagementCommand,
  EngagementGateway,
} from "../capabilities/engagement";

export type EngagementSnapshot = {
  readonly channel: ModerationChannel | null;
  readonly authority: "unchecked" | "broadcaster" | "provider";
  readonly polls: readonly ChannelPoll[];
  readonly predictions: readonly ChannelPrediction[];
  readonly activity: WorkflowActivity;
  readonly sessionRevision: number;
};
export type EngagementReadSelection = {
  readonly polls: boolean;
  readonly predictions: boolean;
};
export interface EngagementController {
  getSnapshot(): EngagementSnapshot;
  subscribe(listener: () => void): () => void;
  open(
    channel: ModerationChannel,
    selection?: EngagementReadSelection,
  ): Promise<void>;
  refresh(): Promise<void>;
  execute(command: EngagementCommand): Promise<void>;
  cancel(): void;
  dispose(): void;
}
export function engagementScopes(
  command: EngagementCommand,
): readonly string[] {
  return command.kind === "create-poll" || command.kind === "end-poll"
    ? ["channel:manage:polls"]
    : ["channel:manage:predictions"];
}
function problem(
  command: EngagementCommand,
  snapshot: EngagementSnapshot,
): string | null {
  if (command.kind === "create-poll" || command.kind === "create-prediction") {
    const poll = command.kind === "create-poll";
    const options = poll ? command.choices : command.outcomes;
    if (!command.title.trim() || command.title.length > (poll ? 60 : 45))
      return `Enter a title of up to ${poll ? 60 : 45} characters.`;
    if (
      options.length < 2 ||
      options.length > (poll ? 5 : 10) ||
      options.some((option) => !option.trim() || option.length > 25)
    )
      return `Enter 2 to ${poll ? 5 : 10} choices, each up to 25 characters.`;
    if (
      !Number.isInteger(command.durationSeconds) ||
      command.durationSeconds < (poll ? 15 : 30) ||
      command.durationSeconds > 1800
    )
      return `Duration must be ${poll ? 15 : 30} to 1800 seconds.`;
    if (
      poll
        ? snapshot.polls.some((item) => item.status === "ACTIVE")
        : snapshot.predictions.some(
            (item) => item.status === "ACTIVE" || item.status === "LOCKED",
          )
    )
      return `Finish the existing ${poll ? "poll" : "prediction"} first.`;
    return null;
  }
  if (command.kind === "end-poll")
    return snapshot.polls.some(
      (item) => item.id === command.id && item.status === "ACTIVE",
    )
      ? null
      : "Refresh and select an active poll.";
  const prediction = snapshot.predictions.find(
    (item) => item.id === command.id,
  );
  if (
    !prediction ||
    (prediction.status !== "ACTIVE" && prediction.status !== "LOCKED")
  )
    return "Refresh and select an active or locked prediction.";
  if (command.kind === "lock-prediction" && prediction.status !== "ACTIVE")
    return "This prediction is already locked.";
  if (
    command.kind === "resolve-prediction" &&
    !prediction.outcomes.some((item) => item.id === command.winningOutcomeId)
  )
    return "Select a winning outcome from this prediction.";
  return null;
}
export function createEngagementController({
  access,
  gateway,
}: {
  readonly access: AuthenticatedPlatformAccess;
  readonly gateway: EngagementGateway;
}): EngagementController {
  let snapshot: EngagementSnapshot = {
    channel: null,
    authority: "unchecked",
    polls: [],
    predictions: [],
    activity: { kind: "idle" },
    sessionRevision: 0,
  };
  let active: AbortController | null = null;
  let readSelection: EngagementReadSelection = {
    polls: true,
    predictions: true,
  };
  const submittedMutations = new WeakSet<AbortSignal>();
  let disposed = false;
  const listeners = new Set<() => void>();
  function publish(next: EngagementSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function current(lease: AbortController) {
    return !disposed && active === lease && !lease.signal.aborted;
  }
  function cancel() {
    if (!active) return;
    const submitted = submittedMutations.has(active.signal);
    active.abort();
    active = null;
    publish({
      ...snapshot,
      activity: {
        kind: "cancelled",
        detail: submitted
          ? "Stopped waiting. A submitted action may already have been applied. Refresh before retrying."
          : "Stopped waiting for the provider read.",
      },
    });
  }
  const unsubscribe = access.subscribe(() => {
    const submitted = active !== null && submittedMutations.has(active.signal);
    active?.abort();
    active = null;
    publish({
      ...snapshot,
      authority: "unchecked",
      polls: [],
      predictions: [],
      activity: {
        kind: "cancelled",
        detail: submitted
          ? "Account changed. A submitted action may already have been applied. Refresh before retrying."
          : "Account changed. Refresh to verify access again.",
      },
      sessionRevision: snapshot.sessionRevision + 1,
    });
  });
  async function run<T>(
    scopes: readonly string[],
    label: string,
    task: (
      credential: ProviderCredential,
      signal: AbortSignal,
      channel: ModerationChannel,
    ) => Promise<ProviderResult<T>>,
    apply: (value: T) => void,
  ) {
    const channel = snapshot.channel;
    if (!channel || active || disposed) return;
    const lease = new AbortController();
    active = lease;
    publish({ ...snapshot, activity: { kind: "pending", label } });
    try {
      const identity = await access.read(channel.platform);
      if (!current(lease)) return;
      if (
        channel.platform !== "twitch" ||
        (identity.kind === "ready" && identity.userId !== channel.id)
      ) {
        publish({
          ...snapshot,
          authority: "provider",
          activity: { kind: "idle" },
        });
        return;
      }
      const requiredScopes = scopes.map((scope) => {
        const manage =
          scope === "channel:read:polls"
            ? "channel:manage:polls"
            : scope === "channel:read:predictions"
              ? "channel:manage:predictions"
              : null;
        return manage &&
          identity.kind === "ready" &&
          identity.scopes.includes(manage)
          ? manage
          : scope;
      });
      const credential = await access.read(channel.platform, requiredScopes);
      if (!current(lease)) return;
      if (credential.kind === "blocked") {
        publish({
          ...snapshot,
          authority: "unchecked",
          activity: {
            kind: "failure",
            detail: credential.detail,
            scopes: credential.reason === "scope" ? scopes : [],
          },
        });
        return;
      }
      if (
        credential.userId !== channel.id ||
        (identity.kind === "ready" &&
          credential.generation !== identity.generation)
      ) {
        publish({
          ...snapshot,
          authority: "unchecked",
          activity: {
            kind: "cancelled",
            detail: "Account changed before the request.",
          },
        });
        return;
      }
      const result = await task(credential, lease.signal, channel);
      if (!current(lease)) return;
      const latest = await access.read(channel.platform);
      if (!current(lease)) return;
      if (
        latest.kind !== "ready" ||
        latest.userId !== credential.userId ||
        latest.generation !== credential.generation
      ) {
        publish({
          ...snapshot,
          authority: "unchecked",
          polls: [],
          predictions: [],
          sessionRevision: snapshot.sessionRevision + 1,
          activity: {
            kind: "cancelled",
            detail: submittedMutations.has(lease.signal)
              ? "Account changed. A submitted action may already have been applied. Refresh before retrying."
              : "Account changed. This result was discarded.",
          },
        });
        return;
      }
      if (result.kind === "failure")
        publish({
          ...snapshot,
          activity: { kind: "failure", detail: result.detail, scopes: [] },
        });
      else {
        apply(result.value);
        publish({
          ...snapshot,
          authority: "broadcaster",
          activity: {
            kind: "success",
            detail: `${label} confirmed by Twitch.`,
          },
        });
      }
    } catch {
      if (current(lease))
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail:
              "The request failed. Refresh before retrying any submitted action.",
            scopes: [],
          },
        });
    } finally {
      if (active === lease) active = null;
    }
  }
  async function refresh() {
    const selection = readSelection;
    await run(
      [
        ...(selection.polls ? ["channel:read:polls"] : []),
        ...(selection.predictions ? ["channel:read:predictions"] : []),
      ],
      "Polls and predictions lookup",
      async (credential, signal, channel) => {
        const polls = selection.polls
          ? await gateway.polls(channel, credential, signal)
          : { kind: "success" as const, value: [] as readonly ChannelPoll[] };
        if (polls.kind === "failure") return polls;
        if (signal.aborted)
          return {
            kind: "failure" as const,
            reason: "network" as const,
            detail: "Request cancelled.",
          };
        const predictions = selection.predictions
          ? await gateway.predictions(channel, credential, signal)
          : {
              kind: "success" as const,
              value: [] as readonly ChannelPrediction[],
            };
        return predictions.kind === "failure"
          ? predictions
          : {
              kind: "success",
              value: { polls: polls.value, predictions: predictions.value },
            };
      },
      (data) => {
        snapshot = {
          ...snapshot,
          polls: data.polls,
          predictions: data.predictions,
        };
      },
    );
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async open(channel, selection = { polls: true, predictions: true }) {
      cancel();
      readSelection = selection;
      publish({
        ...snapshot,
        channel,
        authority: "unchecked",
        polls: [],
        predictions: [],
        sessionRevision: snapshot.sessionRevision + 1,
      });
      await refresh();
    },
    refresh,
    async execute(command) {
      if (active || snapshot.authority !== "broadcaster") return;
      const issue = problem(command, snapshot);
      if (issue) {
        publish({
          ...snapshot,
          activity: { kind: "failure", detail: issue, scopes: [] },
        });
        return;
      }
      await run(
        engagementScopes(command),
        command.kind.replaceAll("-", " "),
        (credential, signal, channel) => {
          submittedMutations.add(signal);
          return gateway.execute(channel, command, credential, signal);
        },
        (update) => {
          snapshot =
            update.kind === "poll"
              ? {
                  ...snapshot,
                  polls: [
                    update.poll,
                    ...snapshot.polls.filter(
                      (poll) => poll.id !== update.poll.id,
                    ),
                  ],
                }
              : {
                  ...snapshot,
                  predictions: [
                    update.prediction,
                    ...snapshot.predictions.filter(
                      (prediction) => prediction.id !== update.prediction.id,
                    ),
                  ],
                };
        },
      );
    },
    cancel,
    dispose() {
      disposed = true;
      active?.abort();
      active = null;
      unsubscribe();
      listeners.clear();
    },
  };
}
