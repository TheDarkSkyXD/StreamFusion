export type ChatSendEligibility = { state: "eligible" } | { state: "ineligible"; reason: string };

export const CHAT_RECONNECTING_REASON = "Chat is reconnecting";
export const CHAT_DISABLED_REASON = "Chat is unavailable";

export type ViewerRequirementState = "satisfied" | "restricted" | "unknown";

export function resolveAccountAgeRequirement({
  accountCreatedAt,
  requiredMinutes,
  nowMs,
}: {
  accountCreatedAt?: string;
  requiredMinutes: number | null;
  nowMs: number;
}): ViewerRequirementState {
  if (requiredMinutes === null || !Number.isFinite(requiredMinutes) || requiredMinutes <= 0) {
    return "satisfied";
  }
  if (!accountCreatedAt) return "unknown";

  const accountCreatedAtMs = Date.parse(accountCreatedAt);
  if (!Number.isFinite(accountCreatedAtMs) || !Number.isFinite(nowMs)) return "unknown";

  return nowMs - accountCreatedAtMs >= requiredMinutes * 60_000 ? "satisfied" : "restricted";
}

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
