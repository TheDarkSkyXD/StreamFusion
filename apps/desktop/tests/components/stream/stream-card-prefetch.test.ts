import { describe, expect, it } from "vitest";

describe("StreamCard intent prefetch", () => {
  it("starts only from real pointer movement or keyboard focus", async () => {
    const source = await import("@/features/discovery/components/stream/stream-card?raw");
    expect(source.default).toContain("onPointerMove={handlePointerMove}");
    expect(source.default).toContain("onFocus={handleFocus}");
    expect(source.default).not.toContain("onMouseEnter=");
  });
});
