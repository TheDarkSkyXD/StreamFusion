import type {
  ChatCommandRole,
  KickCommandDefinition,
  KickCommandEffect,
  KickFirstPartyDestination,
  KickModerationEffect,
} from "./chat-command-registry";

export interface KickCommandSessionDependencies {
  readonly channelLogin: string;
  readonly role: ChatCommandRole;
  readonly sendAction: (message: string) => Promise<void>;
  readonly moderate: (effect: KickModerationEffect) => Promise<void>;
  readonly openExternal: (url: string) => Promise<void>;
  readonly explainHandoff: (message: string) => void;
}

function kickChannelUrl(channelLogin: string): string {
  return `https://kick.com/${encodeURIComponent(channelLogin.toLowerCase())}`;
}

export function getKickFirstPartyUrl(
  destination: KickFirstPartyDestination,
  channelLogin: string
): string {
  switch (destination.kind) {
    case "channel-chat":
      return kickChannelUrl(channelLogin);
  }
}

export async function runKickCommandEffect(
  definition: KickCommandDefinition,
  args: string,
  dependencies: KickCommandSessionDependencies
): Promise<void> {
  const effect: KickCommandEffect = definition.compile(args, dependencies.role);
  switch (effect.kind) {
    case "help":
      throw new Error("Help is handled by the chat composer");
    case "action-message":
      await dependencies.sendAction(effect.message);
      return;
    case "moderation":
      await dependencies.moderate(effect);
      return;
    case "first-party": {
      dependencies.explainHandoff(effect.explanation);
      await dependencies.openExternal(
        getKickFirstPartyUrl(effect.destination, dependencies.channelLogin)
      );
      return;
    }
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}
