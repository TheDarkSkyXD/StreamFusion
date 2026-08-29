import type { ProfileFieldState } from "../../shared/user-profile-types";

export type UserProfileFixtureMatch =
  | { matched: false }
  | {
      matched: true;
      value: Extract<ProfileFieldState<never>, { state: "failed" }>;
    };

// Development may force failures for retry-state proof, but positive profile
// data must always pass through the typed main-process readers.
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
