import type {
  ChatCommandRole,
  KickCommandDefinition,
  KickCommandEffect,
  KickModerationEffect,
} from "./chat-command-registry";
import {
  HANDLED_CHAT_COMMAND,
  localChatCommandResult,
  type ChatCommandOutcome,
} from "./chat-command-outcome";

export interface KickCommandSessionDependencies {
  readonly role: ChatCommandRole;
  readonly sendAction: (message: string) => Promise<void>;
  readonly moderate: (effect: KickModerationEffect) => Promise<void>;
}

export async function runKickCommandEffect(
  definition: KickCommandDefinition,
  args: string,
  dependencies: KickCommandSessionDependencies
): Promise<ChatCommandOutcome> {
  const effect: KickCommandEffect = definition.compile(args, dependencies.role);
  switch (effect.kind) {
    case "help":
      throw new Error("Help is handled by the chat composer");
    case "action-message":
      await dependencies.sendAction(effect.message);
      return HANDLED_CHAT_COMMAND;
    case "moderation":
      await dependencies.moderate(effect);
      return HANDLED_CHAT_COMMAND;
    case "local-notice": {
      return localChatCommandResult({
        tone: "info",
        title: `/${definition.name}`,
        body: effect.message,
      });
    }
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}
