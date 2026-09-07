/** Provider-neutral request port required by chat's Twitch integration. */
export interface TwitchHelixRequest {
  request(endpoint: string, options?: RequestInit): Promise<unknown>;
}
