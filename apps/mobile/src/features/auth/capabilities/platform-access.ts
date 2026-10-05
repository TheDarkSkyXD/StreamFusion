import type { Platform } from "@streamfusion/core/platform";

export type PlatformAccess =
  | {
      readonly kind: "ready";
      readonly platform: Platform;
      readonly accessToken: string;
      readonly clientId: string;
      readonly userId: string;
      readonly username: string;
      readonly generation: number;
      readonly scopes: readonly string[];
    }
  | {
      readonly kind: "blocked";
      readonly reason:
        "sign-in" | "configuration" | "scope" | "expired" | "fixture";
      readonly detail: string;
    };

export interface AuthenticatedPlatformAccess {
  read(
    platform: Platform,
    requiredScopes?: readonly string[],
  ): Promise<PlatformAccess>;
  subscribe(listener: () => void): () => void;
}
