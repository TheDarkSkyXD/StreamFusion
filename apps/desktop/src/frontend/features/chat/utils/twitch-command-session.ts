import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";

import type {
  ChatCommandRole,
  TwitchCommandDefinition,
  TwitchCommandEffect,
  TwitchFirstPartyDestination,
} from "./chat-command-registry";

interface TwitchCommandSessionDependencies {
  readonly channel: { readonly id: string; readonly login: string };
  readonly role: ChatCommandRole;
  readonly grantedScopes: readonly string[];
  readonly sendAction: (message: string) => Promise<void>;
  readonly leaveChannel: () => Promise<void>;
  readonly executeApi: (
    command: Extract<TwitchApiCommand, { operation: "execute-slash-command" }>
  ) => Promise<TwitchApiResult>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly openEngagement: (section: "polls" | "predictions") => void;
  readonly requestReconnect: (missingScopes: readonly string[]) => void;
  readonly explainHandoff: (message: string) => void;
}

function channelFallback(login: string): string {
  return `https://www.twitch.tv/${encodeURIComponent(login)}`;
}

export function getTwitchFirstPartyUrl(
  destination: TwitchFirstPartyDestination,
  channelLogin: string
): string {
  const login = encodeURIComponent(channelLogin.toLowerCase());
  switch (destination.kind) {
    case "channel-chat":
      return `https://www.twitch.tv/popout/${login}/chat?popout=`;
    case "subscriptions":
      return `https://www.twitch.tv/subs/${login}`;
    case "user":
      return `https://www.twitch.tv/${encodeURIComponent(destination.login.toLowerCase())}`;
    case "stream-manager":
      return `https://dashboard.twitch.tv/u/${login}/stream-manager`;
    default: {
      const exhaustive: never = destination;
      return exhaustive;
    }
  }
}

export async function runTwitchCommandEffect(
  definition: TwitchCommandDefinition,
  args: string,
  dependencies: TwitchCommandSessionDependencies
): Promise<void> {
  const effect: TwitchCommandEffect = definition.compile(args, dependencies.role);
  const missingScopes = definition.requiredScopes.filter(
    (scope) => !dependencies.grantedScopes.includes(scope)
  );
  if (missingScopes.length > 0) {
    dependencies.requestReconnect(missingScopes);
    throw new Error(`Reconnect Twitch to use /${definition.name}`);
  }

  switch (effect.kind) {
    case "help":
      throw new Error("Help is handled by the chat composer");
    case "irc-action":
      await dependencies.sendAction(effect.message);
      return;
    case "disconnect":
      await dependencies.leaveChannel();
      return;
    case "engagement":
      dependencies.openEngagement(effect.section);
      return;
    case "first-party": {
      const preferredUrl = getTwitchFirstPartyUrl(effect.destination, dependencies.channel.login);
      dependencies.explainHandoff(effect.explanation);
      try {
        await dependencies.openExternal(preferredUrl);
      } catch {
        await dependencies.openExternal(channelFallback(dependencies.channel.login));
      }
      return;
    }
    case "api": {
      const result = await dependencies.executeApi({
        operation: "execute-slash-command",
        channel: dependencies.channel,
        action: effect.action,
      });
      if (!result.ok) throw new Error(result.error.message);
      return;
    }
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}
