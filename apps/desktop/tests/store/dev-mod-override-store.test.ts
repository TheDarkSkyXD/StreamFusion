import { beforeEach, describe, expect, it } from "vitest";

import { useDevModOverrideStore } from "@/store/dev-mod-override-store";

function resetStore() {
  useDevModOverrideStore.getState().reset();
}

beforeEach(() => resetStore());

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

describe("dev-mod-override-store setters", () => {
  it("setForceModRole toggles the flag", () => {
    useDevModOverrideStore.getState().setForceModRole(true);
    expect(useDevModOverrideStore.getState().forceModRole).toBe(true);
    useDevModOverrideStore.getState().setForceModRole(false);
    expect(useDevModOverrideStore.getState().forceModRole).toBe(false);
  });

  it("setForceModScopes toggles the flag", () => {
    useDevModOverrideStore.getState().setForceModScopes(true);
    expect(useDevModOverrideStore.getState().forceModScopes).toBe(true);
  });

  it("setShowWhisper toggles the flag", () => {
    useDevModOverrideStore.getState().setShowWhisper(true);
    expect(useDevModOverrideStore.getState().showWhisper).toBe(true);
  });

  it("setForceResolvedTwitchBroadcasterId sets the id", () => {
    useDevModOverrideStore.getState().setForceResolvedTwitchBroadcasterId("12345");
    expect(useDevModOverrideStore.getState().forceResolvedTwitchBroadcasterId).toBe("12345");
  });

  it("setForceBroadcasterIdentity toggles the flag", () => {
    useDevModOverrideStore.getState().setForceBroadcasterIdentity(true);
    expect(useDevModOverrideStore.getState().forceBroadcasterIdentity).toBe(true);
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
