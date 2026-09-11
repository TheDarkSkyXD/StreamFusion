import {
  KICK_ANDROID_REDIRECT_URI,
  KICK_APP_SCOPES,
  kickAccountId,
  type KickAuthorizationGateway,
  type KickCallbackInput,
} from "@streamfusion/core/auth";

import type { KickFixtureCallbackKind } from "@mobile/features/auth/capabilities/kick-session";

export const DEVELOPMENT_KICK_CLIENT_ID = "streamfusion-development-kick-fixture";
export type { KickFixtureCallbackKind };

export function createDevelopmentKickAuthFixture(options?: {
  readonly now?: () => number;
}): KickAuthorizationGateway & {
  inject(
    kind: KickFixtureCallbackKind,
    attempt: { readonly state: string } | null,
  ): KickCallbackInput;
} {
  if (!__DEV__)
    throw new Error("The Kick authentication fixture is development-only.");
  const now = options?.now ?? Date.now;
  return {
    exchange: async () => ({
      kind: "exchanged",
      accessToken: "development-kick-access-token",
      refreshToken: "development-kick-refresh-token",
      expiresInSeconds: 3_600,
      scopes: KICK_APP_SCOPES,
    }),
    refresh: async () => ({
      kind: "refreshed",
      accessToken: "development-kick-refreshed-access-token",
      refreshToken: "development-kick-refreshed-refresh-token",
      expiresInSeconds: 3_600,
      scopes: KICK_APP_SCOPES,
    }),
    loadAccount: async () => ({
      kind: "found",
      account: {
        id: kickAccountId("development-kick-account"),
        login: "streamfusion_kick_fixture",
        displayName: "Kick development fixture",
        profileImageUrl: null,
      },
    }),
    inject(kind, attempt) {
      const receivedAtEpochMs = now();
      const state = attempt?.state ?? "fixture-state";
      if (kind === "accepted")
        return {
          code: "development-kick-code",
          error: null,
          receivedAtEpochMs,
          redirectUri: KICK_ANDROID_REDIRECT_URI,
          state,
        };
      if (kind === "denied")
        return {
          code: null,
          error: "access_denied",
          receivedAtEpochMs,
          redirectUri: KICK_ANDROID_REDIRECT_URI,
          state,
        };
      if (kind === "expired")
        return {
          code: "development-kick-code",
          error: null,
          receivedAtEpochMs: receivedAtEpochMs + 11 * 60 * 1_000,
          redirectUri: KICK_ANDROID_REDIRECT_URI,
          state,
        };
      if (kind === "stale")
        return {
          code: "development-kick-code",
          error: null,
          receivedAtEpochMs,
          redirectUri: KICK_ANDROID_REDIRECT_URI,
          state: "unrelated-state",
        };
      if (kind === "duplicate")
        return {
          code: "development-kick-code",
          error: null,
          receivedAtEpochMs,
          redirectUri: KICK_ANDROID_REDIRECT_URI,
          state,
        };
      if (kind === "state-mismatch")
        return {
          code: "development-kick-code",
          error: null,
          receivedAtEpochMs,
          redirectUri: KICK_ANDROID_REDIRECT_URI,
          state: "attacker-state",
        };
      if (kind === "wrong-redirect")
        return {
          code: "development-kick-code",
          error: null,
          receivedAtEpochMs,
          redirectUri: "https://attacker.example/auth/kick/android/callback",
          state,
        };
      return {
        code: "development-kick-code",
        error: null,
        receivedAtEpochMs,
        redirectUri: KICK_ANDROID_REDIRECT_URI,
        state,
      };
    },
  };
}
