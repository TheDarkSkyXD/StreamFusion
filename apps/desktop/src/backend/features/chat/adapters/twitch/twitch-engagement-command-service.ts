import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";
import { z } from "zod";

import type { TwitchHelixRequest } from "../../capabilities/twitch-helix-request";

type EngagementCommand = Extract<
  TwitchApiCommand,
  {
    operation:
      | "get-polls"
      | "get-predictions"
      | "create-poll"
      | "end-poll"
      | "create-prediction"
      | "end-prediction";
  }
>;

const helixEnvelope = z.object({ data: z.array(z.unknown()), pagination: z.record(z.string(), z.unknown()).optional() }).passthrough();

function isEngagementCommand(command: TwitchApiCommand): command is EngagementCommand {
  return ["get-polls", "get-predictions", "create-poll", "end-poll", "create-prediction", "end-prediction"].includes(command.operation);
}

function endpoint(path: string, values: Record<string, string>): string {
  return `${path}?${new URLSearchParams(values).toString()}`;
}

/** Executes Twitch poll and prediction workflows owned by chat engagement. */
export async function executeTwitchEngagementCommand(
  requestor: TwitchHelixRequest,
  command: TwitchApiCommand
): Promise<TwitchApiResult | null> {
  if (!isEngagementCommand(command)) return null;
  if (command.operation === "get-polls" || command.operation === "get-predictions") {
    const result = helixEnvelope.parse(await requestor.request(endpoint(command.operation === "get-polls" ? "/polls" : "/predictions", { broadcaster_id: command.broadcasterId })));
    return { ok: true, data: { data: result.data } };
  }
  if (command.operation === "create-poll") {
    const result = helixEnvelope.parse(await requestor.request("/polls", { method: "POST", body: JSON.stringify({ broadcaster_id: command.broadcasterId, title: command.title, choices: command.choices.map((title) => ({ title })), duration: command.duration }) }));
    return { ok: true, data: result.data[0] };
  }
  if (command.operation === "end-poll") {
    const result = helixEnvelope.parse(await requestor.request("/polls", { method: "PATCH", body: JSON.stringify({ broadcaster_id: command.broadcasterId, id: command.pollId, status: command.status }) }));
    return { ok: true, data: result.data[0] };
  }
  if (command.operation === "create-prediction") {
    const result = helixEnvelope.parse(await requestor.request("/predictions", { method: "POST", body: JSON.stringify({ broadcaster_id: command.broadcasterId, title: command.title, outcomes: command.outcomes.map((title) => ({ title })), prediction_window: command.predictionWindow }) }));
    return { ok: true, data: result.data[0] };
  }
  const result = helixEnvelope.parse(await requestor.request("/predictions", { method: "PATCH", body: JSON.stringify({ broadcaster_id: command.broadcasterId, id: command.predictionId, status: command.status, ...(command.winningOutcomeId ? { winning_outcome_id: command.winningOutcomeId } : {}) }) }));
  return { ok: true, data: result.data[0] };
}
