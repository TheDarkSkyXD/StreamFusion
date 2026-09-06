import { describe, expect, it } from "vitest";

import { MOD_LOG_ACTION_FILTERS } from "@shared/mod-action-filters";

// Guards: Mod Actions filter menu parity with Twitch depends on this shared catalog,
// and query callers use `undefined` for All while `[]` intentionally returns no rows.
describe("MOD_LOG_ACTION_FILTERS", () => {
  it("keeps All plus the fourteen Twitch moderation action categories in order", () => {
    expect(MOD_LOG_ACTION_FILTERS.map((filter) => filter.label)).toEqual([
      "All",
      "Message Deletions",
      "Chat Mode Changes",
      "AutoMod Level Changes",
      "Mods and VIPs",
      "Timeouts and Untimeouts",
      "Blocked and Permitted Terms",
      "Shoutouts",
      "Chat Warnings",
      "Bans and Unbans",
      "Raids",
      "Unban Requests",
      "Suspicious Users",
      "Guest Star",
      "Roles",
    ]);
  });

  it("uses stable IDs and non-empty action values for every non-All category", () => {
    expect(new Set(MOD_LOG_ACTION_FILTERS.map((filter) => filter.id)).size).toBe(
      MOD_LOG_ACTION_FILTERS.length
    );
    expect(MOD_LOG_ACTION_FILTERS[0]).toEqual({ id: "all", label: "All" });

    for (const filter of MOD_LOG_ACTION_FILTERS.slice(1)) {
      const actions = "actions" in filter ? filter.actions : [];
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action.trim()).toBe(action);
        expect(action.length).toBeGreaterThan(0);
      }
    }
  });
});
