export type ChatSendEligibility = { state: "eligible" } | { state: "ineligible"; reason: string };

export const CHAT_RECONNECTING_REASON = "Chat is reconnecting";
export const CHAT_DISABLED_REASON = "Chat is unavailable";

export function resolveChatSendEligibility({
  isAuthenticated,
  canSend,
  disabled,
  roomRestrictionReason,
}: {
  isAuthenticated: boolean;
  canSend: boolean;
  disabled: boolean;
  roomRestrictionReason?: string;
}): ChatSendEligibility {
  if (!isAuthenticated) {
    return { state: "ineligible", reason: "Sign in to chat" };
  }
  if (disabled) {
    return { state: "ineligible", reason: CHAT_DISABLED_REASON };
  }
  if (!canSend) {
    return { state: "ineligible", reason: CHAT_RECONNECTING_REASON };
  }
  if (roomRestrictionReason) {
    return { state: "ineligible", reason: roomRestrictionReason };
  }
  return { state: "eligible" };
}
