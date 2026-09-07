import type { EncryptedToken, KickUser, TwitchUser } from "@shared/auth-types";
import type { Platform } from "@streamfusion/core/platform";

export interface AuthenticationStoreSchema {
  authTokens: Partial<Record<Platform, EncryptedToken>>;
  twitchFollowWriteToken?: EncryptedToken;
  kickWebBearer?: EncryptedToken;
  appTokens?: Partial<Record<Platform, EncryptedToken>>;
  twitchUser: TwitchUser | null;
  kickUser: KickUser | null;
}

export const authenticationDefaults: AuthenticationStoreSchema = {
  authTokens: {},
  appTokens: {},
  twitchUser: null,
  kickUser: null,
};

export const AUTHENTICATION_STORE_KEYS = [
  "authTokens",
  "twitchFollowWriteToken",
  "kickWebBearer",
  "appTokens",
  "twitchUser",
  "kickUser",
] as const satisfies readonly (keyof AuthenticationStoreSchema)[];
