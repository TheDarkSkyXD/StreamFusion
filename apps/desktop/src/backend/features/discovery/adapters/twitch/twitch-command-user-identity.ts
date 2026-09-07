import type { TwitchHelixRequestPort as TwitchRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  requestDecoded,
  resolvedUserResponseSchema,
} from "@backend/api/platforms/twitch/twitch-command-request";

export interface TwitchUserIdentity {
  readonly id: string;
  readonly login: string;
}

export async function resolveTarget(
  requestor: TwitchRequestPort,
  login: string
): Promise<TwitchUserIdentity> {
  const response = await requestDecoded(
    requestor,
    resolvedUserResponseSchema,
    `/users?login=${encodeURIComponent(login.toLowerCase())}`
  );
  const user = response.data?.[0];
  if (!user) throw new Error(`Twitch user ${login} was not found.`);
  return { id: user.id, login: user.login };
}
