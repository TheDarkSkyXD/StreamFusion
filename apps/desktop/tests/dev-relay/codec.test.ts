import { describe, expect, it } from "vitest";
import { decodeRelayValue, encodeRelayValue } from "@/dev-relay/codec";

// Guards: browser relay preserves the structured values used by Electron API calls and events
describe("development relay codec", () => {
  it("round-trips tagged structured values without losing their runtime types", () => {
    const source = {
      absent: undefined,
      createdAt: new Date("2026-07-26T12:34:56.000Z"),
      lookup: new Map<string, number>([
        ["kick", 1],
        ["twitch", 2],
      ]),
      selected: new Set(["kick", "twitch"]),
      audio: new Uint8Array([3, 1, 4]).buffer,
    };

    const decoded = decodeRelayValue(encodeRelayValue(source)) as typeof source;

    expect(decoded.absent).toBeUndefined();
    expect(decoded.createdAt).toEqual(source.createdAt);
    expect(decoded.lookup).toEqual(source.lookup);
    expect(decoded.selected).toEqual(source.selected);
    expect(new Uint8Array(decoded.audio)).toEqual(new Uint8Array([3, 1, 4]));
  });
});
