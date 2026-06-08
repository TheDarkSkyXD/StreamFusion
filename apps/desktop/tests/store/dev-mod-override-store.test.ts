import { beforeEach, describe, expect, it } from "vitest";

import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

function resetStore() {
  useDevModOverrideStore.getState().reset();
}

beforeEach(() => resetStore());

// Guards: reset wipes every override flag so a dev session can't leak forced-mod-role / forced-broadcaster-identity / forced-broadcaster-id into the next test or hot-reload
// Guards: default state has every flag off and every id empty — guarantees the debug overlay never silently lights up mod UI in a fresh install
describe("dev-mod-override-store initial state", () => {
  it("starts with all flags off", () => {
    const s = useDevModOverrideStore.getState();
    expect(s.forceModRole).toBe(false);
    expect(s.forceModScopes).toBe(false);
    expect(s.showWhisper).toBe(false);
    expect(s.forceResolvedTwitchBroadcasterId).toBe("");
    expect(s.forceBroadcasterIdentity).toBe(false);
  });
});

describe("dev-mod-override-store reset", () => {
  it("restores every field to its default", () => {
    useDevModOverrideStore.getState().setForceModRole(true);
    useDevModOverrideStore.getState().setForceModScopes(true);
    useDevModOverrideStore.getState().setShowWhisper(true);
    useDevModOverrideStore.getState().setForceResolvedTwitchBroadcasterId("99");
    useDevModOverrideStore.getState().setForceBroadcasterIdentity(true);

    useDevModOverrideStore.getState().reset();
    const s = useDevModOverrideStore.getState();
    expect(s.forceModRole).toBe(false);
    expect(s.forceModScopes).toBe(false);
    expect(s.showWhisper).toBe(false);
    expect(s.forceResolvedTwitchBroadcasterId).toBe("");
    expect(s.forceBroadcasterIdentity).toBe(false);
  });
});
