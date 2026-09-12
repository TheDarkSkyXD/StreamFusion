import type { FollowView } from "../capabilities/platform-reads";

export function guestFollowView(): FollowView {
  return { kind: "guest-unsupported" };
}

export function followCopy(follow: FollowView): string {
  if (follow.kind === "pending") return "Updating follow state.";
  if (follow.kind === "failed") return follow.reason;
  return "Guest Follow is not available yet.";
}
