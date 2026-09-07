import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  requestDecoded,
  resolvedUserResponseSchema,
} from "@backend/api/platforms/twitch/twitch-command-request";

export async function getCurrentUser(requestor: TwitchHelixRequestPort) {
  const response = await requestDecoded(requestor, resolvedUserResponseSchema, "/users");
  const user = response.data?.[0];
  if (!user) throw new Error("Twitch could not resolve the signed-in user.");
  return { id: user.id, login: user.login };
}
