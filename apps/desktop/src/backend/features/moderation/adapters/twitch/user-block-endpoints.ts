import type { TwitchHelixRequestPort } from "@backend/api/platforms/twitch/twitch-transport";

export function blockUser(client: TwitchHelixRequestPort, targetUserId: string): Promise<unknown> {
  return client.request(`/users/blocks?target_user_id=${encodeURIComponent(targetUserId)}`, {
    method: "PUT",
  });
}

export function unblockUser(
  client: TwitchHelixRequestPort,
  targetUserId: string
): Promise<unknown> {
  return client.request(`/users/blocks?target_user_id=${encodeURIComponent(targetUserId)}`, {
    method: "DELETE",
  });
}
