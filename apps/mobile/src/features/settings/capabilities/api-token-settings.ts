export type ApiTokenPlatform = "twitch" | "kick";

export type ApiTokenStatus =
  | { readonly kind: "loading" }
  | { readonly kind: "not-connected" }
  | {
      readonly kind: "valid";
      readonly login: string;
      readonly userId: string | null;
      readonly expiresAtEpochMs: number;
      readonly scopes: readonly string[];
    }
  | {
      readonly kind: "invalid";
      readonly reason: string;
    };

export type ApiTokenPlatformView = {
  readonly platform: ApiTokenPlatform;
  readonly label: string;
  readonly status: ApiTokenStatus;
};

export type ApiTokenSettingsView = {
  readonly twitch: ApiTokenPlatformView;
  readonly kick: ApiTokenPlatformView;
  readonly disclosure: string;
};
