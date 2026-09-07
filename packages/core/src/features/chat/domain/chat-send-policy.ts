export type ChatSendEligibility =
  | { readonly state: "eligible" }
  | { readonly state: "ineligible"; readonly reason: string };

export const CHAT_RECONNECTING_REASON = "Chat is reconnecting";
export const CHAT_DISABLED_REASON = "Chat is unavailable";

export type ViewerRequirementState = "satisfied" | "restricted" | "unknown";

export function resolveAccountAgeRequirement(options: {
  readonly accountCreatedAt?: string;
  readonly requiredMinutes: number | null;
  readonly nowMs: number;
}): ViewerRequirementState {
  if (
    options.requiredMinutes === null ||
    !Number.isFinite(options.requiredMinutes) ||
    options.requiredMinutes <= 0
  ) {
    return "satisfied";
  }
  if (!options.accountCreatedAt) return "unknown";

  const accountCreatedAtMs = Date.parse(options.accountCreatedAt);
  if (!Number.isFinite(accountCreatedAtMs) || !Number.isFinite(options.nowMs)) {
    return "unknown";
  }

  return options.nowMs - accountCreatedAtMs >= options.requiredMinutes * 60_000
    ? "satisfied"
    : "restricted";
}

export function resolveChatSendEligibility(options: {
  readonly isAuthenticated: boolean;
  readonly canSend: boolean;
  readonly disabled: boolean;
  readonly roomRestrictionReason?: string;
}): ChatSendEligibility {
  if (!options.isAuthenticated) {
    return { state: "ineligible", reason: "Sign in to chat" };
  }
  if (options.disabled) {
    return { state: "ineligible", reason: CHAT_DISABLED_REASON };
  }
  if (!options.canSend) {
    return { state: "ineligible", reason: CHAT_RECONNECTING_REASON };
  }
  if (options.roomRestrictionReason) {
    return { state: "ineligible", reason: options.roomRestrictionReason };
  }
  return { state: "eligible" };
}
