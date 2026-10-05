import {
  createProviderRequest,
  malformed,
  object,
  rows,
} from "@mobile/features/moderation/adapters/provider-request";
import type {
  ModerationChannel,
  ProviderCredential,
  ProviderResult,
} from "@mobile/features/moderation/capabilities/moderation";
import type {
  ChannelPoll,
  ChannelPrediction,
  EngagementChoice,
  EngagementCommand,
  EngagementGateway,
  EngagementUpdate,
} from "../capabilities/engagement";

function choices(
  value: unknown,
  countKey: "votes" | "users",
): readonly EngagementChoice[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: EngagementChoice[] = [];
  for (const item of value) {
    const row = object(item);
    const count = row?.[countKey];
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.title !== "string" ||
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count < 0
    )
      return null;
    parsed.push({ id: row.id, title: row.title, votes: count });
  }
  return parsed.length >= 2 ? parsed : null;
}
function parsePoll(value: unknown): ChannelPoll | null {
  const row = object(value);
  if (!row || typeof row.id !== "string" || typeof row.title !== "string")
    return null;
  const options = choices(row.choices, "votes");
  const status = row.status;
  if (
    !options ||
    (status !== "ACTIVE" &&
      status !== "COMPLETED" &&
      status !== "TERMINATED" &&
      status !== "ARCHIVED" &&
      status !== "MODERATED" &&
      status !== "INVALID")
  )
    return null;
  return { id: row.id, title: row.title, status, choices: options };
}
function parsePrediction(value: unknown): ChannelPrediction | null {
  const row = object(value);
  if (!row || typeof row.id !== "string" || typeof row.title !== "string")
    return null;
  const options = choices(row.outcomes, "users");
  const status = row.status;
  if (
    !options ||
    (status !== "ACTIVE" &&
      status !== "LOCKED" &&
      status !== "RESOLVED" &&
      status !== "CANCELED") ||
    (row.winning_outcome_id !== null &&
      typeof row.winning_outcome_id !== "string")
  )
    return null;
  return {
    id: row.id,
    title: row.title,
    status,
    outcomes: options,
    winningOutcomeId: row.winning_outcome_id,
  };
}
export function createEngagementApi({
  fetch = globalThis.fetch,
}: { readonly fetch?: typeof globalThis.fetch } = {}): EngagementGateway {
  const request = createProviderRequest(fetch);
  function authority(
    channel: ModerationChannel,
    credential: ProviderCredential,
  ): ProviderResult<never> | null {
    return channel.platform !== "twitch" ||
      credential.platform !== "twitch" ||
      channel.id !== credential.userId
      ? {
          kind: "failure",
          reason: "unsupported",
          detail:
            "Open the provider for this channel's polls and predictions. Twitch REST access requires the broadcaster account; Kick does not publish these APIs.",
        }
      : null;
  }
  async function read<T>(
    channel: ModerationChannel,
    credential: ProviderCredential,
    signal: AbortSignal,
    endpoint: string,
    parse: (value: unknown) => T | null,
  ): Promise<ProviderResult<readonly T[]>> {
    const problem = authority(channel, credential);
    if (problem) return problem;
    const result = await request({
      credential,
      signal,
      path: `/${endpoint}?broadcaster_id=${encodeURIComponent(channel.id)}&first=20`,
    });
    if (result.kind === "failure") return result;
    const data = rows(result.value);
    if (!data) return malformed();
    const parsed: T[] = [];
    for (const row of data) {
      const entry = parse(row);
      if (!entry) return malformed();
      parsed.push(entry);
    }
    return { kind: "success", value: parsed };
  }
  async function execute(
    channel: ModerationChannel,
    command: EngagementCommand,
    credential: ProviderCredential,
    signal: AbortSignal,
  ): Promise<ProviderResult<EngagementUpdate>> {
    const problem = authority(channel, credential);
    if (problem) return problem;
    const poll = command.kind === "create-poll" || command.kind === "end-poll";
    let body: unknown;
    switch (command.kind) {
      case "create-poll":
        body = {
          broadcaster_id: channel.id,
          title: command.title,
          choices: command.choices.map((title) => ({ title })),
          duration: command.durationSeconds,
          channel_points_voting_enabled: false,
        };
        break;
      case "end-poll":
        body = {
          broadcaster_id: channel.id,
          id: command.id,
          status: command.archive ? "ARCHIVED" : "TERMINATED",
        };
        break;
      case "create-prediction":
        body = {
          broadcaster_id: channel.id,
          title: command.title,
          outcomes: command.outcomes.map((title) => ({ title })),
          prediction_window: command.durationSeconds,
        };
        break;
      case "lock-prediction":
        body = { broadcaster_id: channel.id, id: command.id, status: "LOCKED" };
        break;
      case "cancel-prediction":
        body = {
          broadcaster_id: channel.id,
          id: command.id,
          status: "CANCELED",
        };
        break;
      case "resolve-prediction":
        body = {
          broadcaster_id: channel.id,
          id: command.id,
          status: "RESOLVED",
          winning_outcome_id: command.winningOutcomeId,
        };
        break;
    }
    const result = await request({
      credential,
      signal,
      path: poll ? "/polls" : "/predictions",
      method:
        command.kind === "create-poll" || command.kind === "create-prediction"
          ? "POST"
          : "PATCH",
      body,
    });
    if (result.kind === "failure") return result;
    const item = rows(result.value)?.[0];
    if (poll) {
      const parsed = parsePoll(item);
      return parsed
        ? { kind: "success", value: { kind: "poll", poll: parsed } }
        : malformed();
    }
    const parsed = parsePrediction(item);
    return parsed
      ? { kind: "success", value: { kind: "prediction", prediction: parsed } }
      : malformed();
  }
  return {
    polls: (channel, credential, signal) =>
      read(channel, credential, signal, "polls", parsePoll),
    predictions: (channel, credential, signal) =>
      read(channel, credential, signal, "predictions", parsePrediction),
    execute,
  };
}
