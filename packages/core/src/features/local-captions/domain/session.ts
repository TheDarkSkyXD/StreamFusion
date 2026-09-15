export type LocalCaptionLease =
  | { readonly kind: "granted"; readonly sessionId: string }
  | { readonly kind: "rejected"; readonly reason: string };

export function grantCaptionSession(input: {
  readonly activeSessionId: string | null;
  readonly reason: string;
  readonly sessionId: string;
}): LocalCaptionLease {
  if (
    input.activeSessionId !== null &&
    input.activeSessionId !== input.sessionId
  ) {
    return { kind: "rejected", reason: input.reason };
  }
  return { kind: "granted", sessionId: input.sessionId };
}

export function releaseCaptionSession(input: {
  readonly activeSessionId: string | null;
  readonly sessionId: string;
}): string | null {
  return input.activeSessionId === input.sessionId
    ? null
    : input.activeSessionId;
}
