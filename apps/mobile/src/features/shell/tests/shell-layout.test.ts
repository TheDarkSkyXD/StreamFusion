import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../components/app-shell.tsx", import.meta.url),
  "utf8",
);

describe("shell layout", () => {
  it("keeps portrait workspace scroll bounds explicit", () => {
    expect(source).toContain("style={styles.screenScroll}");
    expect(source).toMatch(
      /screenScroll:\s*\{\s*flex:\s*1,\s*minHeight:\s*0,/u,
    );
  });
});
