import type {
  KickCredentialRepository,
  TwitchCredentialRepository,
} from "@streamfusion/core/auth";
import type { Platform } from "@streamfusion/core/platform";
import type { KickAccountSessionController } from "../domain/kick-account-session-controller";
import type { TwitchAccountSessionController } from "../domain/twitch-account-session-controller";
import type {
  AuthenticatedPlatformAccess,
  PlatformAccess,
} from "../capabilities/platform-access";

export function createAuthenticatedPlatformAccess(input: {
  readonly twitch: {
    readonly clientId: string | null;
    readonly controller: Pick<
      TwitchAccountSessionController,
      "getSnapshot" | "refresh" | "subscribe"
    >;
    readonly repository: Pick<TwitchCredentialRepository, "read">;
  };
  readonly kick: {
    readonly clientId: () => Promise<string>;
    readonly controller: Pick<
      KickAccountSessionController,
      "getSnapshot" | "refresh" | "subscribe"
    >;
    readonly repository: Pick<KickCredentialRepository, "read">;
  };
  readonly fixtureEnabled: (platform: Platform) => boolean;
  readonly now?: () => number;
}): AuthenticatedPlatformAccess {
  const now = input.now ?? Date.now;
  return {
    async read(platform, requiredScopes = []): Promise<PlatformAccess> {
      if (input.fixtureEnabled(platform))
        return {
          kind: "blocked",
          reason: "fixture",
          detail:
            "Connect a real account to use platform actions. Development accounts cannot send requests.",
        };
      const provider = platform === "twitch" ? input.twitch : input.kick;
      const configuredClientId =
        typeof provider.clientId === "string" ? provider.clientId : null;
      if (platform === "twitch" && !configuredClientId)
        return {
          kind: "blocked",
          reason: "configuration",
          detail: `${platform === "twitch" ? "Twitch" : "Kick"} sign-in is unavailable in this build. You can still browse and watch streams.`,
        };
      let account = provider.controller.getSnapshot();
      if (account.kind !== "connected")
        return {
          kind: "blocked",
          reason: "sign-in",
          detail: `Connect ${platform} in Accounts to use this action.`,
        };
      if (account.expiresAtEpochMs <= now() + 60_000) {
        await provider.controller.refresh();
        account = provider.controller.getSnapshot();
      }
      const stored = await provider.repository.read();
      account = provider.controller.getSnapshot();
      if (
        account.kind !== "connected" ||
        stored.kind !== "ready" ||
        stored.credential.expiresAtEpochMs <= now()
      )
        return {
          kind: "blocked",
          reason: "expired",
          detail: `Reconnect ${platform}. The account could not be refreshed.`,
        };
      const credential = stored.credential;
      if (
        credential.account.login !== account.login ||
        input.fixtureEnabled(platform)
      )
        return {
          kind: "blocked",
          reason: "sign-in",
          detail: "The account changed. Try the action again.",
        };
      const missing = requiredScopes.filter(
        (scope) => !credential.scopes.includes(scope),
      );
      if (missing.length)
        return {
          kind: "blocked",
          reason: "scope",
          detail: `Reconnect ${platform} to grant ${missing.join(", ")}.`,
        };
      let clientId = configuredClientId;
      if (platform === "kick") {
        try {
          clientId = await input.kick.clientId();
        } catch {
          return {
            kind: "blocked",
            reason: "configuration",
            detail:
              "Kick configuration is temporarily unavailable. Retry the action.",
          };
        }
        const latest = await input.kick.repository.read();
        const visible = input.kick.controller.getSnapshot();
        if (
          input.fixtureEnabled("kick") ||
          latest.kind !== "ready" ||
          visible.kind !== "connected" ||
          latest.credential.generation !== credential.generation ||
          latest.credential.accessToken !== credential.accessToken ||
          latest.credential.account.id !== credential.account.id ||
          visible.login !== credential.account.login ||
          requiredScopes.some(
            (scope) => !latest.credential.scopes.includes(scope),
          ) ||
          latest.credential.expiresAtEpochMs <= now()
        )
          return {
            kind: "blocked",
            reason: "sign-in",
            detail: "The account changed. Try the action again.",
          };
      }
      if (!clientId)
        return {
          kind: "blocked",
          reason: "configuration",
          detail: "Account configuration is unavailable.",
        };
      return {
        kind: "ready",
        platform,
        accessToken: credential.accessToken,
        clientId,
        userId: credential.account.id,
        username: credential.account.login,
        generation: credential.generation,
        scopes: credential.scopes,
      };
    },
    subscribe(listener) {
      const context = () =>
        JSON.stringify(
          [input.twitch.controller, input.kick.controller].map((controller) => {
            const account = controller.getSnapshot();
            return account.kind === "connected"
              ? [account.kind, account.login, account.scopes]
              : [account.kind];
          }),
        );
      let previous = context();
      const changed = () => {
        const next = context();
        if (next === previous) return;
        previous = next;
        listener();
      };
      const twitch = input.twitch.controller.subscribe(changed);
      const kick = input.kick.controller.subscribe(changed);
      return () => {
        twitch();
        kick();
      };
    },
  };
}
