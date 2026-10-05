import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import type { Platform } from "@streamfusion/core/platform";
import type {
  BannedPage,
  ChatSettings,
  ModerationChannel,
  ModerationCommand,
  ModerationGateway,
  ProviderCredential,
  ProviderResult,
  ReviewPage,
  ReviewTool,
} from "../capabilities/moderation";

export type WorkflowActivity =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly label: string }
  | { readonly kind: "success"; readonly detail: string }
  | {
      readonly kind: "failure";
      readonly detail: string;
      readonly scopes: readonly string[];
    }
  | { readonly kind: "cancelled"; readonly detail: string };
export type ModerationSnapshot = {
  readonly platform: Platform;
  readonly channels: readonly ModerationChannel[];
  readonly selection: {
    readonly channel: ModerationChannel;
    readonly role: "broadcaster" | "moderator";
  } | null;
  readonly activity: WorkflowActivity;
  readonly banned: BannedPage | null;
  readonly settings: ChatSettings | null;
  readonly review: ReviewPage | null;
  readonly sessionRevision: number;
};
export interface ModerationController {
  getSnapshot(): ModerationSnapshot;
  subscribe(listener: () => void): () => void;
  loadChannels(platform: Platform): Promise<void>;
  selectChannel(channel: ModerationChannel): Promise<void>;
  execute(command: ModerationCommand): Promise<void>;
  readBanned(more?: boolean): Promise<void>;
  readSettings(): Promise<void>;
  readReview(tool: ReviewTool, more?: boolean): Promise<void>;
  cancel(): void;
  dispose(): void;
}
export function moderationScopes(
  platform: Platform,
  command?: ModerationCommand,
): readonly string[] {
  if (!command)
    return platform === "twitch"
      ? ["user:read:moderated_channels"]
      : ["channel:read"];
  switch (command.kind) {
    case "timeout":
    case "ban":
    case "unban":
      return platform === "twitch"
        ? ["moderator:manage:banned_users"]
        : ["moderation:ban"];
    case "delete-message":
      return platform === "twitch"
        ? ["moderator:manage:chat_messages"]
        : ["moderation:chat_message:manage"];
    case "chat-settings":
      return ["moderator:manage:chat_settings"];
    case "automod":
      return ["moderator:manage:automod"];
    case "resolve-unban":
      return ["moderator:manage:unban_requests"];
    case "membership":
      return command.group === "moderators"
        ? ["channel:manage:moderators"]
        : ["channel:manage:vips"];
  }
}
function commandProblem(
  command: ModerationCommand,
  platform: Platform,
): string | null {
  if (
    (command.kind === "ban" ||
      command.kind === "timeout" ||
      command.kind === "unban" ||
      command.kind === "membership") &&
    !/^\d+$/.test(command.userId)
  )
    return "Enter the provider's numeric user ID.";
  if (
    command.kind === "resolve-unban" &&
    (!command.requestId || command.resolutionText.length > 500)
  )
    return "Select an unban request and keep the response within 500 characters.";
  if (
    (command.kind === "delete-message" || command.kind === "automod") &&
    !command.messageId.trim()
  )
    return "Enter a message ID.";
  if (
    (command.kind === "ban" || command.kind === "timeout") &&
    command.reason.length > (platform === "kick" ? 100 : 500)
  )
    return `The reason is limited to ${platform === "kick" ? 100 : 500} characters.`;
  if (
    command.kind === "timeout" &&
    (!Number.isInteger(command.durationSeconds) ||
      command.durationSeconds < 1 ||
      command.durationSeconds > 1209600)
  )
    return "Twitch timeouts must be between 1 second and 14 days.";
  if (
    command.kind === "timeout" &&
    platform === "kick" &&
    (command.durationSeconds % 60 !== 0 || command.durationSeconds > 604800)
  )
    return "Kick timeouts must be whole minutes, from 1 minute to 7 days.";
  if (
    command.kind === "chat-settings" &&
    (!Number.isInteger(command.settings.slowSeconds) ||
      command.settings.slowSeconds < 3 ||
      command.settings.slowSeconds > 120 ||
      !Number.isInteger(command.settings.followerMinutes) ||
      command.settings.followerMinutes < 0 ||
      command.settings.followerMinutes > 129600)
  )
    return "Slow mode must be 3 to 120 seconds. Follower duration must be 0 to 129600 minutes.";
  return null;
}

export function createModerationController({
  access,
  gateway,
}: {
  readonly access: AuthenticatedPlatformAccess;
  readonly gateway: ModerationGateway;
}): ModerationController {
  let snapshot: ModerationSnapshot = {
    platform: "twitch",
    channels: [],
    selection: null,
    activity: { kind: "idle" },
    banned: null,
    settings: null,
    review: null,
    sessionRevision: 0,
  };
  let active: AbortController | null = null;
  const submittedMutations = new WeakSet<AbortSignal>();
  let disposed = false;
  const listeners = new Set<() => void>();
  function publish(next: ModerationSnapshot) {
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
      platform: snapshot.platform,
      channels: [],
      selection: null,
      activity: {
        kind: "cancelled",
        detail: submitted
          ? "Account changed. A submitted action may already have been applied. Refresh before retrying."
          : "Account changed. Select a channel again to verify your role.",
      },
      banned: null,
      settings: null,
      review: null,
      sessionRevision: snapshot.sessionRevision + 1,
    });
  });
  async function run<T>(
    platform: Platform,
    scopes: readonly string[],
    label: string,
    task: (
      credential: ProviderCredential,
      signal: AbortSignal,
    ) => Promise<ProviderResult<T>>,
    apply: (value: T) => void,
    ownerChannelId?: string,
  ) {
    if (disposed || active) return;
    const lease = new AbortController();
    active = lease;
    publish({ ...snapshot, activity: { kind: "pending", label } });
    try {
      const identity = await access.read(platform);
      if (!current(lease)) return;
      const alternatives: Readonly<Record<string, string>> = {
        "moderator:read:unban_requests": "moderator:manage:unban_requests",
        "moderation:read": "channel:manage:moderators",
        "channel:read:vips": "channel:manage:vips",
      };
      const requestedScopes =
        platform === "twitch" &&
        identity.kind === "ready" &&
        identity.userId === ownerChannelId
          ? []
          : scopes;
      const requiredScopes = requestedScopes.map((scope) => {
        const alternative = alternatives[scope];
        return alternative &&
          identity.kind === "ready" &&
          identity.scopes.includes(alternative)
          ? alternative
          : scope;
      });
      const credential = await access.read(platform, requiredScopes);
      if (!current(lease)) return;
      if (credential.kind === "blocked") {
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail: credential.detail,
            scopes: credential.reason === "scope" ? scopes : [],
          },
        });
        return;
      }
      const result = await task(credential, lease.signal);
      if (!current(lease)) return;
      const latest = await access.read(platform);
      if (!current(lease)) return;
      if (
        latest.kind !== "ready" ||
        latest.userId !== credential.userId ||
        latest.generation !== credential.generation
      ) {
        publish({
          ...snapshot,
          channels: [],
          selection: null,
          banned: null,
          settings: null,
          review: null,
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
          activity: {
            kind: "success",
            detail: `${label} confirmed by ${platform === "twitch" ? "Twitch" : "Kick"}.`,
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
  async function authorized<T>(
    credential: ProviderCredential,
    signal: AbortSignal,
    channel: ModerationChannel,
    task: () => Promise<ProviderResult<T>>,
  ): Promise<ProviderResult<T>> {
    const role = await gateway.verify(channel, credential, signal);
    if (role.kind === "failure") return role;
    if (signal.aborted)
      return {
        kind: "failure",
        reason: "network",
        detail: "Request cancelled.",
      };
    const latest = await access.read(channel.platform);
    if (
      signal.aborted ||
      latest.kind !== "ready" ||
      latest.userId !== credential.userId ||
      latest.generation !== credential.generation
    )
      return {
        kind: "failure",
        reason: "auth",
        detail: "Account changed before submitting this action.",
      };
    return task();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async loadChannels(platform) {
      cancel();
      publish({
        ...snapshot,
        platform,
        channels: [],
        selection: null,
        banned: null,
        settings: null,
        review: null,
        sessionRevision: snapshot.sessionRevision + 1,
      });
      await run(
        platform,
        moderationScopes(platform),
        "Channel lookup",
        (credential, signal) => gateway.channels(credential, signal),
        (channels) => {
          snapshot = { ...snapshot, channels };
        },
      );
    },
    async selectChannel(channel) {
      cancel();
      publish({
        ...snapshot,
        platform: channel.platform,
        selection: null,
        banned: null,
        settings: null,
        review: null,
        sessionRevision: snapshot.sessionRevision + 1,
      });
      await run(
        channel.platform,
        moderationScopes(channel.platform),
        "Role verification",
        (credential, signal) => gateway.verify(channel, credential, signal),
        (role) => {
          snapshot = { ...snapshot, selection: { channel, role } };
        },
        channel.id,
      );
    },
    async execute(command) {
      const selection = snapshot.selection;
      if (!selection || active) return;
      const problem = commandProblem(command, selection.channel.platform);
      if (problem) {
        publish({
          ...snapshot,
          activity: { kind: "failure", detail: problem, scopes: [] },
        });
        return;
      }
      const channel = selection.channel;
      if (
        command.kind === "membership" &&
        (channel.platform !== "twitch" || selection.role !== "broadcaster")
      ) {
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail:
              "Only the Twitch broadcaster can change moderators and VIPs.",
            scopes: [],
          },
        });
        return;
      }
      if (
        command.kind === "resolve-unban" &&
        !snapshot.review?.items.some(
          (item) => item.kind === "unban" && item.id === command.requestId,
        )
      ) {
        publish({
          ...snapshot,
          activity: {
            kind: "failure",
            detail: "Refresh and select a pending unban request.",
            scopes: [],
          },
        });
        return;
      }
      await run(
        channel.platform,
        moderationScopes(channel.platform, command),
        command.kind === "automod"
          ? `${command.action === "ALLOW" ? "Allow" : "Deny"} held message`
          : command.kind.replaceAll("-", " "),
        (credential, signal) =>
          authorized(credential, signal, channel, () => {
            submittedMutations.add(signal);
            return gateway.execute(channel, command, credential, signal);
          }),
        () => {
          snapshot = {
            ...snapshot,
            banned: null,
            settings:
              command.kind === "chat-settings"
                ? command.settings
                : snapshot.settings,
            review:
              command.kind === "membership" || command.kind === "resolve-unban"
                ? null
                : snapshot.review,
          };
        },
      );
    },
    async readSettings() {
      const selection = snapshot.selection;
      if (!selection) return;
      const channel = selection.channel;
      await run(
        channel.platform,
        ["moderator:read:chat_settings"],
        "Chat settings lookup",
        (credential, signal) =>
          authorized(credential, signal, channel, () =>
            gateway.settings(channel, credential, signal),
          ),
        (settings) => {
          snapshot = { ...snapshot, settings };
        },
      );
    },
    async readBanned(more = false) {
      const selection = snapshot.selection;
      if (!selection || (more && !snapshot.banned?.cursor)) return;
      const channel = selection.channel;
      const previous = more ? snapshot.banned : null;
      await run(
        channel.platform,
        ["moderator:manage:banned_users"],
        "Banned users lookup",
        (credential, signal) =>
          authorized(credential, signal, channel, () =>
            gateway.banned(
              channel,
              previous?.cursor ?? null,
              credential,
              signal,
            ),
          ),
        (page) => {
          snapshot = {
            ...snapshot,
            banned: {
              users: [...(previous?.users ?? []), ...page.users],
              cursor: page.cursor,
            },
          };
        },
      );
    },
    async readReview(tool, more = false) {
      const selection = snapshot.selection;
      if (
        !selection ||
        (more && (!snapshot.review?.cursor || snapshot.review.tool !== tool))
      )
        return;
      const previous = more ? snapshot.review : null;
      const channel = selection.channel;
      const scopes =
        tool === "unban-requests"
          ? ["moderator:read:unban_requests"]
          : tool === "moderators"
            ? ["moderation:read"]
            : ["channel:read:vips"];
      await run(
        channel.platform,
        scopes,
        `${tool.replaceAll("-", " ")} lookup`,
        (credential, signal) =>
          authorized(credential, signal, channel, () =>
            gateway.review(
              channel,
              tool,
              previous?.cursor ?? null,
              credential,
              signal,
            ),
          ),
        (page) => {
          snapshot = {
            ...snapshot,
            review: {
              ...page,
              items: [...(previous?.items ?? []), ...page.items],
            },
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
