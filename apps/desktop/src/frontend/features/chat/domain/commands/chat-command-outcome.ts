export interface ChatCommandResult {
  readonly tone: "info" | "error";
  readonly title: string;
  readonly body: string;
}

export type ChatCommandOutcome =
  | { readonly kind: "handled" }
  | { readonly kind: "local-result"; readonly result: ChatCommandResult };

export const HANDLED_CHAT_COMMAND = { kind: "handled" } satisfies ChatCommandOutcome;

export function localChatCommandResult(result: ChatCommandResult): ChatCommandOutcome {
  return { kind: "local-result", result };
}
