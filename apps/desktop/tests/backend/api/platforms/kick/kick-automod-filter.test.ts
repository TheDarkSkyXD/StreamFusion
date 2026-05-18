import { describe, expect, it } from "vitest";

import { evaluate } from "@/backend/api/platforms/kick/kick-automod-filter";
import type { KickAutomodConfig } from "@/backend/services/database-service";

function makeConfig(
  overrides: Partial<KickAutomodConfig> = {},
): KickAutomodConfig {
  return {
    channelId: "c1",
    keywordBlocklist: [],
    severityIdentity: [],
    severitySexual: [],
    severityAggression: [],
    severityBullying: [],
    allowlistUserIds: [],
    updatedAt: 0,
    ...overrides,
  };
}

describe("kick-automod-filter.evaluate", () => {
  it("holds a message that hits the blocklist (AE9)", () => {
    const cfg = makeConfig({ keywordBlocklist: ["spam"] });
    const verdict = evaluate(
      { senderUserId: "u1", text: "buy cheap spam now" },
      cfg,
    );
    expect(verdict).toEqual({
      held: true,
      category: "blocklist",
      matchedKeyword: "spam",
    });
  });

  it("matches case-insensitively", () => {
    const cfg = makeConfig({ keywordBlocklist: ["spam"] });
    const verdict = evaluate(
      { senderUserId: "u1", text: "SPAM is bad" },
      cfg,
    );
    expect(verdict.held).toBe(true);
  });

  it("respects word boundaries: 'ass' does not match 'class' or 'assert'", () => {
    const cfg = makeConfig({ keywordBlocklist: ["ass"] });
    expect(evaluate({ senderUserId: "u1", text: "i love class" }, cfg)).toEqual(
      { held: false },
    );
    expect(
      evaluate({ senderUserId: "u1", text: "i assert this" }, cfg),
    ).toEqual({ held: false });
    expect(evaluate({ senderUserId: "u1", text: "you ass" }, cfg).held).toBe(
      true,
    );
  });

  it("bypasses evaluation when sender is allow-listed", () => {
    const cfg = makeConfig({
      keywordBlocklist: ["spam"],
      allowlistUserIds: ["u1"],
    });
    const verdict = evaluate(
      { senderUserId: "u1", text: "spam spam spam" },
      cfg,
    );
    expect(verdict).toEqual({ held: false });
  });

  it("returns held=false when config is null or all lists are empty", () => {
    expect(evaluate({ senderUserId: "u1", text: "anything" }, null)).toEqual({
      held: false,
    });
    expect(
      evaluate({ senderUserId: "u1", text: "anything" }, makeConfig()),
    ).toEqual({ held: false });
  });

  it("blocklist wins when a keyword appears in both blocklist and severity tier", () => {
    const cfg = makeConfig({
      keywordBlocklist: ["bad"],
      severityIdentity: ["bad"],
    });
    const verdict = evaluate(
      { senderUserId: "u1", text: "this is bad" },
      cfg,
    );
    expect(verdict).toEqual({
      held: true,
      category: "blocklist",
      matchedKeyword: "bad",
    });
  });

  it("attributes severity categories when only that tier matches", () => {
    const cfg = makeConfig({ severityBullying: ["loser"] });
    expect(
      evaluate({ senderUserId: "u1", text: "you are a loser" }, cfg),
    ).toEqual({ held: true, category: "bullying", matchedKeyword: "loser" });
  });
});
