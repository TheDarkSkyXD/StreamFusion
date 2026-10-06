import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type {
  ModerationChannel,
  ModerationGateway,
  ProviderCredential,
  ProviderResult,
} from "../capabilities/moderation";
import type {
  ModerationLog,
  ModerationLogEntry,
  ModerationLogRepository,
} from "../capabilities/moderation-log";
import type {
  CategoryPage,
  ChannelTool,
  ChannelToolCommand,
  ChannelToolsGateway,
  FeedKind,
  FeedState,
  ModerationFeedGateway,
  ToolSnapshot,
  ToolCommandResult,
} from "../capabilities/provider-tools";
import type { WorkflowActivity } from "./moderation-controller";
import {
  acceptedScopes,
  broadcasterTool,
  channelToolScopes,
  moderationFeedScopes,
  toolCommandProblem,
} from "./provider-tool-policy";

type HistoryState =
  | { readonly kind: "idle" | "loading" }
  | { readonly kind: "ready"; readonly value: ModerationLog }
  | { readonly kind: "failure"; readonly detail: string };
export type ProviderToolsSnapshot = {
  readonly channel: ModerationChannel | null;
  readonly revision: number;
  readonly activity: WorkflowActivity;
  readonly data: ToolSnapshot | null;
  readonly categories: CategoryPage | null;
  readonly feed: FeedState;
  readonly feedKind: FeedKind | null;
  readonly history: HistoryState;
  readonly raid:
    | { readonly kind: "idle" }
    | {
        readonly kind: "pending";
        readonly targetId: string;
        readonly createdAt: string;
      }
    | { readonly kind: "uncertain"; readonly detail: string };
};
export interface ProviderToolsController {
  getSnapshot(): ProviderToolsSnapshot;
  subscribe(listener: () => void): () => void;
  bindChannel(channel: ModerationChannel | null, revision: number): void;
  read(
    tool: ChannelTool,
    more?: boolean,
    rewardId?: string | null,
  ): Promise<void>;
  searchCategories(query: string, more?: boolean): Promise<void>;
  execute(command: ChannelToolCommand): Promise<void>;
  startFeed(feed: FeedKind): Promise<void>;
  stopFeed(): void;
  readHistory(): Promise<void>;
  setRetention(days: number): Promise<void>;
  cancel(): void;
  dispose(): void;
}
export function createProviderToolsController({
  access,
  authorization,
  gateway,
  feeds,
  log,
  now = Date.now,
}: {
  readonly access: AuthenticatedPlatformAccess;
  readonly authorization: Pick<ModerationGateway, "verify">;
  readonly gateway: ChannelToolsGateway;
  readonly feeds: ModerationFeedGateway;
  readonly log?: ModerationLogRepository;
  readonly now?: () => number;
}): ProviderToolsController {
  let snapshot: ProviderToolsSnapshot = {
    channel: null,
    revision: 0,
    activity: { kind: "idle" },
    data: null,
    categories: null,
    feed: { kind: "idle" },
    feedKind: null,
    history: { kind: "idle" },
    raid: { kind: "idle" },
  };
  const listeners = new Set<() => void>();
  let active: {
    readonly lease: AbortController;
    submitted: boolean;
    readonly command: ChannelToolCommand | null;
  } | null = null;
  let feedLease: AbortController | null = null;
  let historyRevision = 0;
  let feedCoverage: {
    readonly channel: ModerationChannel;
    readonly actorId: string;
    readonly since: string;
  } | null = null;
  let sequence = 0;
  let disposed = false;
  function publish(next: ProviderToolsSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function current(lease: AbortController, revision: number) {
    return !disposed && !lease.signal.aborted && snapshot.revision === revision;
  }
  function stopFeed() {
    feedLease?.abort();
    feedLease = null;
    if (feedCoverage) {
      const coverage = feedCoverage;
      feedCoverage = null;
      void saveLog({
        id: `coverage:end:${coverage.since}:${now()}`,
        at: now(),
        channel: coverage.channel,
        actorId: coverage.actorId,
        userId: null,
        action: "feed-disconnected",
        detail: `Moderation feed collection ended. Connected since ${coverage.since}. Events after disconnect are unavailable.`,
        source: "app-observed",
        outcome: "confirmed",
      });
    }
    if (snapshot.feed.kind === "live")
      publish({
        ...snapshot,
        feed: { ...snapshot.feed, kind: "disconnected" },
      });
    else if (snapshot.feed.kind === "connecting")
      publish({ ...snapshot, feed: { kind: "idle" } });
  }
  function cancel() {
    if (!active) return;
    const operation = active;
    operation.lease.abort();
    active = null;
    const detail = operation.submitted
      ? "Stopped waiting. The provider may have applied the submitted action. Refresh before retrying."
      : "Stopped waiting for the provider read.";
    publish({
      ...snapshot,
      activity: { kind: "cancelled", detail },
      raid:
        operation.submitted &&
        (operation.command?.kind === "raid" ||
          operation.command?.kind === "cancel-raid")
          ? { kind: "uncertain", detail }
          : snapshot.raid,
    });
  }
  function clear(channel: ModerationChannel | null, revision: number) {
    cancel();
    stopFeed();
    historyRevision++;
    publish({
      channel,
      revision,
      activity: { kind: "idle" },
      data: null,
      categories: null,
      feed: { kind: "idle" },
      feedKind: null,
      history: { kind: "idle" },
      raid: { kind: "idle" },
    });
  }
  const unsubscribe = access.subscribe(() =>
    clear(null, snapshot.revision + 1),
  );
  async function credential(
    channel: ModerationChannel,
    scopes: readonly string[],
  ): Promise<ProviderResult<ProviderCredential>> {
    const identity = await access.read(channel.platform);
    const required =
      identity.kind === "ready"
        ? acceptedScopes(scopes, identity.scopes)
        : scopes;
    const value = await access.read(channel.platform, required);
    return value.kind === "ready"
      ? { kind: "success", value }
      : {
          kind: "failure",
          reason: value.reason === "scope" ? "permission" : "auth",
          detail: value.detail,
        };
  }
  async function sameAccount(
    channel: ModerationChannel,
    actor: ProviderCredential,
    lease: AbortController,
    revision: number,
  ) {
    const latest = await access.read(channel.platform);
    return (
      current(lease, revision) &&
      latest.kind === "ready" &&
      latest.userId === actor.userId &&
      latest.generation === actor.generation
    );
  }
  async function saveLog(entry: ModerationLogEntry) {
    if (!log) return;
    try {
      await log.record(entry);
    } catch {
      publish({
        ...snapshot,
        history: {
          kind: "failure",
          detail: "The provider action's local history could not be saved.",
        },
      });
    }
  }
  async function run<T>(
    scopes: readonly string[],
    label: string,
    owner: boolean,
    command: ChannelToolCommand | null,
    task: (
      channel: ModerationChannel,
      actor: ProviderCredential,
      lease: AbortController,
      beforeSubmit: () => Promise<boolean>,
    ) => Promise<ProviderResult<T>>,
    apply: (value: T) => void,
  ) {
    const channel = snapshot.channel;
    if (!channel || disposed || active) return;
    const revision = snapshot.revision;
    const lease = new AbortController();
    const operation = { lease, submitted: false, command };
    active = operation;
    publish({ ...snapshot, activity: { kind: "pending", label } });
    const logRecord: { entry: ModerationLogEntry | null } = { entry: null };
    try {
      const actorResult = await credential(channel, scopes);
      if (!current(lease, revision) || active !== operation) return;
      if (actorResult.kind === "failure") {
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail: actorResult.detail,
            scopes: actorResult.reason === "permission" ? scopes : [],
          },
        });
        return;
      }
      const actor = actorResult.value;
      if (owner && actor.userId !== channel.id) {
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail:
              "This tool requires the selected channel's broadcaster account.",
            scopes: [],
          },
        });
        return;
      }
      const role = await authorization.verify(channel, actor, lease.signal);
      if (!current(lease, revision) || active !== operation) return;
      if (role.kind === "failure") {
        publish({
          ...snapshot,
          activity: { kind: "failure", detail: role.detail, scopes: [] },
        });
        return;
      }
      if (!(await sameAccount(channel, actor, lease, revision))) {
        if (current(lease, revision)) clear(null, revision + 1);
        return;
      }
      const beforeSubmit = async () => {
        if (
          !(await sameAccount(channel, actor, lease, revision)) ||
          active !== operation
        )
          return false;
        if (command) {
          logRecord.entry = {
            id: `issued:${now()}:${++sequence}`,
            at: now(),
            channel,
            actorId: actor.userId,
            userId: "userId" in command ? command.userId : null,
            action: command.kind,
            detail:
              command.kind === "whisper"
                ? "Whisper sent from this app"
                : command.kind === "raid"
                  ? `Target ${command.targetId}`
                  : command.kind.replaceAll("-", " "),
            source: "app-issued",
            outcome: "submitted",
          };
          await saveLog(logRecord.entry);
        }
        const authorized =
          active === operation &&
          (await sameAccount(channel, actor, lease, revision));
        operation.submitted = authorized;
        return authorized;
      };
      const result = await task(channel, actor, lease, beforeSubmit);
      if (logRecord.entry)
        await saveLog({
          ...logRecord.entry,
          outcome:
            result.kind === "success"
              ? "confirmed"
              : result.reason === "network" || result.reason === "provider"
                ? "uncertain"
                : "rejected",
        });
      if (!current(lease, revision) || active !== operation) return;
      if (!(await sameAccount(channel, actor, lease, revision))) {
        clear(null, revision + 1);
        return;
      }
      if (result.kind === "failure")
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail: result.detail,
            scopes: result.reason === "permission" ? scopes : [],
          },
          raid:
            operation.submitted &&
            (command?.kind === "raid" || command?.kind === "cancel-raid") &&
            (result.reason === "network" || result.reason === "provider")
              ? { kind: "uncertain", detail: result.detail }
              : snapshot.raid,
        });
      else {
        apply(result.value);
        publish({
          ...snapshot,
          activity: {
            kind: "success",
            detail:
              command?.kind === "raid"
                ? "Twitch scheduled a pending raid. Completion has not been observed."
                : `${label} confirmed by Twitch.`,
          },
        });
      }
    } catch {
      if (logRecord.entry)
        await saveLog({ ...logRecord.entry, outcome: "uncertain" });
      if (current(lease, revision))
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail: operation.submitted
              ? "The request was interrupted. The provider may have applied the action. Refresh before retrying."
              : "Could not reach this tool. Check your connection.",
            scopes: [],
          },
        });
    } finally {
      if (active === operation) active = null;
    }
  }
  async function readHistory() {
    const channel = snapshot.channel;
    if (!channel) return;
    const revision = ++historyRevision;
    const context = snapshot.revision;
    if (!log) {
      publish({
        ...snapshot,
        history: {
          kind: "failure",
          detail:
            "Local moderation history storage is unavailable in this host.",
        },
      });
      return;
    }
    publish({ ...snapshot, history: { kind: "loading" } });
    try {
      const actor = await access.read(channel.platform);
      if (actor.kind !== "ready") throw new Error(actor.detail);
      const value = await log.read(channel, actor.userId);
      const latest = await access.read(channel.platform);
      if (
        !disposed &&
        revision === historyRevision &&
        context === snapshot.revision &&
        latest.kind === "ready" &&
        latest.userId === actor.userId &&
        latest.generation === actor.generation
      )
        publish({ ...snapshot, history: { kind: "ready", value } });
    } catch (error) {
      if (
        !disposed &&
        revision === historyRevision &&
        context === snapshot.revision
      )
        publish({
          ...snapshot,
          history: {
            kind: "failure",
            detail:
              error instanceof Error
                ? error.message
                : "Local moderation history could not be read.",
          },
        });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bindChannel(channel, revision) {
      if (
        snapshot.revision !== revision ||
        snapshot.channel?.id !== channel?.id ||
        snapshot.channel?.platform !== channel?.platform
      )
        clear(channel, revision);
    },
    async read(tool, more = false, rewardId = null) {
      const previous =
        more && snapshot.data?.kind === tool ? snapshot.data : null;
      const cursor = previous && "cursor" in previous ? previous.cursor : null;
      if (more && !cursor) return;
      await run(
        channelToolScopes(tool),
        `${tool.replaceAll("-", " ")} lookup`,
        broadcasterTool(tool),
        null,
        (channel, actor, lease) =>
          gateway.read(
            channel,
            actor,
            tool,
            lease.signal,
            cursor,
            rewardId ??
              (previous?.kind === "rewards" ? previous.rewardId : null),
          ),
        (value) => {
          let data = value;
          if (
            previous?.kind === "blocked-terms" &&
            value.kind === "blocked-terms"
          )
            data = { ...value, terms: [...previous.terms, ...value.terms] };
          if (previous?.kind === "community" && value.kind === "community")
            data = { ...value, people: [...previous.people, ...value.people] };
          if (
            previous?.kind === "raid-targets" &&
            value.kind === "raid-targets"
          )
            data = {
              ...value,
              targets: [...previous.targets, ...value.targets],
            };
          if (
            previous?.kind === "rewards" &&
            value.kind === "rewards" &&
            previous.rewardId === value.rewardId
          )
            data = {
              ...value,
              redemptions: [...previous.redemptions, ...value.redemptions],
            };
          snapshot = { ...snapshot, data };
        },
      );
    },
    async searchCategories(query, more = false) {
      const trimmed = query.trim();
      if (!trimmed) return;
      const previous =
        more && snapshot.categories?.query === trimmed
          ? snapshot.categories
          : null;
      if (more && !previous?.cursor) return;
      await run(
        [],
        "Category search",
        true,
        null,
        (_channel, actor, lease) =>
          gateway.searchCategories(
            actor,
            trimmed,
            lease.signal,
            previous?.cursor,
          ),
        (value) => {
          snapshot = {
            ...snapshot,
            categories: {
              ...value,
              categories: [
                ...(previous?.categories ?? []),
                ...value.categories,
              ],
            },
          };
        },
      );
    },
    async execute(command) {
      const problem = toolCommandProblem(command);
      if (problem) {
        publish({
          ...snapshot,
          activity: { kind: "failure", detail: problem, scopes: [] },
        });
        return;
      }
      if (
        command.kind === "reward-decision" &&
        (snapshot.data?.kind !== "rewards" ||
          !snapshot.data.rewards.some(
            (reward) => reward.id === command.rewardId,
          ) ||
          !snapshot.data.redemptions.some(
            (item) =>
              item.id === command.redemptionId &&
              item.rewardId === command.rewardId &&
              item.status === "UNFULFILLED",
          ))
      ) {
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail:
              "Refresh and select a pending redemption for a reward created by this Twitch application.",
            scopes: [],
          },
        });
        return;
      }
      await run<ToolCommandResult>(
        channelToolScopes(command),
        command.kind.replaceAll("-", " "),
        broadcasterTool(command),
        command,
        (channel, actor, lease, beforeSubmit) =>
          gateway.execute(channel, actor, command, lease.signal, beforeSubmit),
        (value) => {
          snapshot = {
            ...snapshot,
            data: null,
            raid:
              value.kind === "raid-pending"
                ? {
                    kind: "pending",
                    targetId: value.targetId,
                    createdAt: value.createdAt,
                  }
                : command.kind === "cancel-raid"
                  ? { kind: "idle" }
                  : snapshot.raid,
          };
        },
      );
    },
    async startFeed(feed) {
      stopFeed();
      const channel = snapshot.channel;
      if (!channel || disposed) return;
      const revision = snapshot.revision;
      const lease = new AbortController();
      feedLease = lease;
      const scopes = moderationFeedScopes(feed);
      publish({ ...snapshot, feedKind: feed, feed: { kind: "connecting" } });
      try {
        const actorResult = await credential(channel, scopes);
        if (!current(lease, revision) || feedLease !== lease) return;
        if (actorResult.kind === "failure") {
          publish({
            ...snapshot,
            feed:
              actorResult.reason === "permission"
                ? { kind: "permission", detail: actorResult.detail, scopes }
                : { kind: "failure", detail: actorResult.detail },
          });
          return;
        }
        const actor = actorResult.value;
        if (feed === "rewards" && actor.userId !== channel.id) {
          publish({
            ...snapshot,
            feed: {
              kind: "permission",
              detail: "Twitch reward feeds require the broadcaster account.",
              scopes: [],
            },
          });
          return;
        }
        const role = await authorization.verify(channel, actor, lease.signal);
        if (!current(lease, revision) || feedLease !== lease) return;
        if (role.kind === "failure") {
          publish({
            ...snapshot,
            feed: { kind: "permission", detail: role.detail, scopes: [] },
          });
          return;
        }
        if (!(await sameAccount(channel, actor, lease, revision))) {
          if (current(lease, revision)) clear(null, revision + 1);
          return;
        }
        let updates: Promise<void> = Promise.resolve();
        const recorded = new Set<string>();
        await feeds.subscribe(
          channel,
          actor,
          feed,
          (state) => {
            updates = updates
              .then(async () => {
                if (feedLease !== lease) return;
                if (!(await sameAccount(channel, actor, lease, revision))) {
                  if (current(lease, revision)) clear(null, revision + 1);
                  return;
                }
                publish({ ...snapshot, feed: state });
                if (
                  feed === "actions" &&
                  (state.kind === "live" || state.kind === "disconnected")
                ) {
                  if (state.kind === "live" && !feedCoverage) {
                    feedCoverage = {
                      channel,
                      actorId: actor.userId,
                      since: state.since,
                    };
                    await saveLog({
                      id: `coverage:start:${state.since}`,
                      at: now(),
                      channel,
                      actorId: actor.userId,
                      userId: null,
                      action: "feed-connected",
                      detail: `Moderation feed collection started ${state.since}. Earlier provider activity is unavailable.`,
                      source: "app-observed",
                      outcome: "confirmed",
                    });
                  }
                  for (const event of state.items) {
                    if (recorded.has(event.id)) continue;
                    recorded.add(event.id);
                    if (recorded.size > 500) {
                      const oldest = recorded.values().next().value;
                      if (oldest) recorded.delete(oldest);
                    }
                    await saveLog({
                      id: `event:${event.id}`,
                      at: Date.parse(event.occurredAt),
                      channel,
                      actorId: actor.userId,
                      userId: event.userId,
                      action: event.action,
                      detail: `${event.name} · ${event.detail}`,
                      source: "app-observed",
                      outcome: "confirmed",
                    });
                  }
                  if (state.kind === "disconnected") stopFeed();
                }
                if (state.kind === "failure" || state.kind === "permission")
                  stopFeed();
              })
              .catch(() => {
                if (current(lease, revision))
                  publish({
                    ...snapshot,
                    feed: {
                      kind: "failure",
                      detail: "This feed could not be updated.",
                    },
                  });
              });
          },
          lease.signal,
        );
      } catch {
        if (current(lease, revision))
          publish({
            ...snapshot,
            feed: {
              kind: "failure",
              detail: "The live feed could not connect.",
            },
          });
      }
    },
    stopFeed,
    readHistory,
    async setRetention(days) {
      const channel = snapshot.channel;
      if (!channel || !log) return;
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        publish({
          ...snapshot,
          history: {
            kind: "failure",
            detail: "Choose 1 to 365 days of local history.",
          },
        });
        return;
      }
      const revision = snapshot.revision;
      try {
        const actor = await access.read(channel.platform);
        if (actor.kind !== "ready") throw new Error(actor.detail);
        await log.setRetention(channel, actor.userId, days);
        if (revision === snapshot.revision) await readHistory();
      } catch (error) {
        if (revision === snapshot.revision)
          publish({
            ...snapshot,
            history: {
              kind: "failure",
              detail:
                error instanceof Error
                  ? error.message
                  : "Retention could not be saved.",
            },
          });
      }
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
      stopFeed();
      unsubscribe();
      listeners.clear();
      historyRevision++;
    },
  };
}
