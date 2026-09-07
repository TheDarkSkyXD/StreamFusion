import type { AuthToken, TwitchUser } from "@shared/auth-types";
import type { Platform } from "@streamfusion/core/platform";
import type { TokenStatusResult } from "@shared/ipc-channels";

export interface ChatSessionAccess {
  auth: {
    getToken: (platform: "kick") => Promise<AuthToken | null>;
    getValidTwitchToken: () => Promise<string | null>;
    getTwitchUser: () => Promise<TwitchUser | null>;
    tokenStatus: (platform: Platform) => Promise<TokenStatusResult>;
    openTwitchLogin: () => Promise<void>;
  };
}
