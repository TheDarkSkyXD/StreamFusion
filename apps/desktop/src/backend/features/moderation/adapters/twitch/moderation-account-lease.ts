import { twitchAuthService } from "../../../authentication/adapters/twitch/twitch-auth";
import { authenticationRepository } from "../../../authentication/data/authentication-repository";
import { tokenExchangeService } from "../../../authentication/adapters/oauth/token-exchange";

export interface ModerationAccountLease {
  userId: string;
  scopes: readonly string[];
  accessToken: string;
  isCurrent(): boolean;
  onCredentialsChanged(listener: () => void): () => void;
}

/** Credentials remain inside this main-process lease and never enter a DTO. */
export async function acquireModerationAccountLease(): Promise<ModerationAccountLease | null> {
  const accessToken = await twitchAuthService.getValidAccessToken();
  if (!accessToken) return null;
  const status = await tokenExchangeService.getTokenStatus("twitch", { accessToken });
  const userId = status.userId;
  if (!status.valid || !userId || twitchAuthService.getAccessToken() !== accessToken) return null;
  return {
    accessToken,
    userId,
    scopes: status.scopes ?? [],
    onCredentialsChanged: (listener) =>
      authenticationRepository.onTwitchCredentialsChanged(listener),
    isCurrent: () =>
      twitchAuthService.getAccessToken() === accessToken &&
      authenticationRepository.getTwitchUser()?.id === userId,
  };
}
