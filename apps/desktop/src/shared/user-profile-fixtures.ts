import type { ProfileFieldState } from "./user-profile-types";

export type UserProfileFixtureMatch =
  | { matched: false }
  | { matched: true; value: Extract<ProfileFieldState<never>, { state: "failed" }> };

/** Development-only failure fixture; production profile data stays main-process sourced. */
export function getUserProfileFixture(
  path: readonly string[],
  search: string
): UserProfileFixtureMatch {
  if (new URLSearchParams(search).get("userProfileFixture") !== "unavailable") {
    return { matched: false };
  }
  const method = path.join(".");
  if (!method.startsWith("userProfiles.")) return { matched: false };
  return {
    matched: true,
    value:
      method === "userProfiles.getTwitchIdentity"
        ? { state: "failed", message: "Couldn’t verify" }
        : { state: "failed", message: "Unavailable" },
  };
}
