import type { FollowedIdentityRef } from "@streamfusion/core/relay";

export function missingIdentityRefs(input: {
  readonly matchedIds: ReadonlySet<string>;
  readonly matchedLogins: ReadonlySet<string>;
  readonly refs: readonly FollowedIdentityRef[];
}): readonly FollowedIdentityRef[] {
  return input.refs.filter((ref) => {
    if (ref.kind === "id") return !input.matchedIds.has(ref.value);
    return !input.matchedLogins.has(ref.value);
  });
}
